import { useCallback,useEffect,useState } from 'react';
import { ActivityIndicator,Linking,Pressable,StyleSheet,Text,View } from 'react-native';
import { beginLinearConnection,disconnectLinear,getLinearStatus } from '../api/client';

export function LinearIntegrationControl(){
  const[connected,setConnected]=useState<boolean>();
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string>();
  const refresh=useCallback(()=>{void getLinearStatus().then(status=>{setConnected(status.connected);setError(undefined)}).catch(reason=>setError(message(reason)))},[]);
  useEffect(()=>{
    refresh();
    const handle=(value:string)=>{
      const url=new URL(value);
      if(url.protocol==='tooledvoice:'&&url.hostname==='integrations'&&url.pathname==='/linear'){
        if(url.searchParams.get('status')==='connected')refresh();else setError(url.searchParams.get('code')??'LINEAR_CONNECTION_FAILED');
      }
    };
    void Linking.getInitialURL().then(value=>{if(value)handle(value)}).catch(()=>undefined);
    const subscription=Linking.addEventListener('url',event=>handle(event.url));
    return()=>subscription.remove();
  },[refresh]);
  async function connect(){setBusy(true);setError(undefined);try{const{authorizationUrl}=await beginLinearConnection();await Linking.openURL(authorizationUrl)}catch(reason){setError(message(reason))}finally{setBusy(false)}}
  async function disconnect(){setBusy(true);setError(undefined);try{await disconnectLinear();setConnected(false)}catch(reason){setError(message(reason))}finally{setBusy(false)}}
  return <View style={styles.container}>
    <View><Text style={styles.label}>LINEAR</Text><Text style={[styles.status,connected&&styles.connected]}>{connected?'CONNECTED':'NOT CONNECTED'}</Text></View>
    <Pressable disabled={busy} onPress={()=>void(connected?disconnect():connect())} style={({pressed})=>[styles.button,pressed&&styles.pressed]} accessibilityRole="button" accessibilityLabel={connected?'Disconnect Linear':'Connect Linear'}>{busy?<ActivityIndicator color="#e8ff58" size="small"/>:<Text style={styles.buttonText}>{connected?'DISCONNECT':'CONNECT'}</Text>}</Pressable>
    {error?<Text style={styles.error} accessibilityRole="alert">{error}</Text>:null}
  </View>;
}
const message=(reason:unknown)=>reason instanceof Error?reason.message:'LINEAR_CONNECTION_FAILED';
const styles=StyleSheet.create({
  container:{borderTopWidth:1,borderBottomWidth:1,borderColor:'#303229',paddingVertical:12,marginTop:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap'},
  label:{color:'#f0f1e8',fontSize:10,fontWeight:'900',letterSpacing:1.8},
  status:{color:'#77796e',fontSize:9,fontWeight:'700',letterSpacing:1.1,marginTop:4},
  connected:{color:'#e8ff58'},
  button:{borderWidth:1,borderColor:'#5a5c52',minWidth:102,height:36,alignItems:'center',justifyContent:'center'},
  buttonText:{color:'#f0f1e8',fontSize:9,fontWeight:'800',letterSpacing:1.3},
  pressed:{opacity:.65},
  error:{color:'#ff765f',fontSize:10,width:'100%',marginTop:9},
});
