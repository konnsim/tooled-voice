import { useCallback,useEffect,useState } from 'react';
import { ActivityIndicator,Linking,Pressable,StyleSheet,Text,View } from 'react-native';
import { beginToolConnection,disconnectTool,getToolConnections,setToolApprovalPolicy,type ToolApprovalPolicy,type ToolConnection } from '../api/client';

export function ToolIntegrationControl(){
  const[connections,setConnections]=useState<ToolConnection[]>([]);
  const[configured,setConfigured]=useState(false);
  const[approvalPolicy,setApprovalPolicy]=useState<ToolApprovalPolicy>('ask');
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string>();
  const refresh=useCallback(()=>{void getToolConnections().then(status=>{setConnections(status.connections);setConfigured(status.configured);setApprovalPolicy(status.approvalPolicy);setError(undefined)}).catch(reason=>setError(message(reason)))},[]);
  useEffect(()=>{
    refresh();
    const handle=(value:string)=>{
      const url=new URL(value);
      if(url.protocol==='tooledvoice:'&&url.hostname==='integrations'&&(url.pathname==='/linear'||url.pathname==='/composio')){
        if(url.searchParams.get('status')!=='error')refresh();else setError(url.searchParams.get('code')??'CONNECTION_FAILED');
      }
    };
    void Linking.getInitialURL().then(value=>{if(value)handle(value)}).catch(()=>undefined);
    const subscription=Linking.addEventListener('url',event=>handle(event.url));
    return()=>subscription.remove();
  },[refresh]);
  async function toggle(connection:ToolConnection){setBusy(true);setError(undefined);try{if(connection.connected)await disconnectTool(connection.slug);else{const{authorizationUrl}=await beginToolConnection(connection.slug);await Linking.openURL(authorizationUrl)}await refresh()}catch(reason){setError(message(reason))}finally{setBusy(false)}}
  async function updateApprovalPolicy(next:ToolApprovalPolicy){if(next===approvalPolicy)return;setBusy(true);setError(undefined);try{const status=await setToolApprovalPolicy(next);setApprovalPolicy(status.approvalPolicy)}catch(reason){setError(message(reason))}finally{setBusy(false)}}
  return <View style={styles.container}>
    <View style={styles.heading}><Text style={styles.label}>CONNECTED TOOLS</Text>{busy?<ActivityIndicator color="#e8ff58" size="small"/>:<Text style={styles.status}>{configured?'POWERED BY COMPOSIO':'DIRECT CONNECTIONS'}</Text>}</View>
    <View style={styles.connectionList}>{connections.map(connection=><View key={connection.slug} style={styles.connectionRow}><View><Text style={styles.connectionName}>{connection.name.toUpperCase()}</Text><Text style={[styles.status,connection.connected&&styles.connected]}>{connection.connected?'CONNECTED':'NOT CONNECTED'}</Text></View><Pressable disabled={busy||(!configured&&connection.slug!=='linear')} onPress={()=>void toggle(connection)} style={({pressed})=>[styles.button,(!configured&&connection.slug!=='linear')&&styles.disabled,pressed&&styles.pressed]} accessibilityRole="button" accessibilityLabel={`${connection.connected?'Disconnect':'Connect'} ${connection.name}`}><Text style={styles.buttonText}>{connection.connected?'REMOVE':'CONNECT'}</Text></Pressable></View>)}</View>
    <View style={styles.permissions}><Text style={styles.permissionsLabel}>WHEN TOOLS MAKE CHANGES</Text><View style={styles.permissionChoices}><Pressable disabled={busy} onPress={()=>void updateApprovalPolicy('ask')} style={[styles.permissionChoice,approvalPolicy==='ask'&&styles.permissionChoiceActive]} accessibilityRole="button" accessibilityState={{selected:approvalPolicy==='ask'}}><Text style={[styles.permissionText,approvalPolicy==='ask'&&styles.permissionTextActive]}>ASK ME</Text></Pressable><Pressable disabled={busy} onPress={()=>void updateApprovalPolicy('automatic')} style={[styles.permissionChoice,approvalPolicy==='automatic'&&styles.permissionChoiceActive]} accessibilityRole="button" accessibilityState={{selected:approvalPolicy==='automatic'}}><Text style={[styles.permissionText,approvalPolicy==='automatic'&&styles.permissionTextActive]}>ALLOW</Text></Pressable></View><Text style={styles.permissionsHint}>{approvalPolicy==='ask'?'You approve each change. Reads stay automatic.':'Changes run without confirmation in new voice sessions.'}</Text></View>
    {error?<Text style={styles.error} accessibilityRole="alert">{error}</Text>:null}
  </View>;
}
const message=(reason:unknown)=>reason instanceof Error?reason.message:'CONNECTION_FAILED';
const styles=StyleSheet.create({
  container:{borderTopWidth:1,borderBottomWidth:1,borderColor:'#303229',paddingVertical:12,marginTop:18},
  heading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  label:{color:'#f0f1e8',fontSize:10,fontWeight:'900',letterSpacing:1.8},
  status:{color:'#77796e',fontSize:9,fontWeight:'700',letterSpacing:1.1,marginTop:4},
  connected:{color:'#e8ff58'},
  connectionList:{marginTop:10},
  connectionRow:{minHeight:48,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderTopWidth:1,borderColor:'#303229'},
  connectionName:{color:'#f0f1e8',fontSize:10,fontWeight:'800',letterSpacing:1.3},
  button:{borderWidth:1,borderColor:'#5a5c52',minWidth:102,height:36,alignItems:'center',justifyContent:'center'},
  buttonText:{color:'#f0f1e8',fontSize:9,fontWeight:'800',letterSpacing:1.3},
  pressed:{opacity:.65},
  disabled:{opacity:.3},
  error:{color:'#ff765f',fontSize:10,width:'100%',marginTop:9},
  permissions:{width:'100%',borderTopWidth:1,borderColor:'#303229',marginTop:12,paddingTop:12},
  permissionsLabel:{color:'#9b9d91',fontSize:8,fontWeight:'800',letterSpacing:1.2},
  permissionChoices:{flexDirection:'row',gap:8,marginTop:8},
  permissionChoice:{flex:1,height:34,borderWidth:1,borderColor:'#5a5c52',alignItems:'center',justifyContent:'center'},
  permissionChoiceActive:{borderColor:'#e8ff58',backgroundColor:'#25281d'},
  permissionText:{color:'#9b9d91',fontSize:9,fontWeight:'900',letterSpacing:1.2},
  permissionTextActive:{color:'#e8ff58'},
  permissionsHint:{color:'#77796e',fontSize:10,lineHeight:15,marginTop:7},
});
