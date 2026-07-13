import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { authCallbackUrl, subscribeToAuthDeepLinks } from './src/auth/deep-link';
import { supabase } from './src/auth/supabase';
import { ToolIntegrationControl } from './src/integrations/linear-control';
import { useVoiceSession } from './src/realtime/use-voice-session';

const labels={idle:'READY',authenticating:'AUTHENTICATING',connecting:'LINKING',connected:'ONLINE',listening:'LISTENING',thinking:'THINKING',speaking:'SPEAKING',reconnecting:'RECONNECTING',error:'FAULT',disconnected:'OFFLINE'} as const;
export default function App(){return <SafeAreaProvider><AppContent/></SafeAreaProvider>}
function AppContent(){const[session,setSession]=useState<Session|null>();const[authError,setAuthError]=useState<string>();useEffect(()=>{const unsubscribeDeepLinks=subscribeToAuthDeepLinks(setAuthError);void supabase.auth.getSession().then(({data})=>setSession(data.session));const{data}=supabase.auth.onAuthStateChange((_event,next)=>setSession(next));return()=>{unsubscribeDeepLinks();data.subscription.unsubscribe()}},[]);if(session===undefined)return <View style={styles.loading}><ActivityIndicator color="#e8ff58"/><StatusBar style="light"/></View>;return session?<VoiceScreen email={session.user.email ?? 'authenticated'} />:<AuthScreen initialMessage={authError}/>}

function AuthScreen({initialMessage}:{initialMessage:string|undefined}){
  const[email,setEmail]=useState('');
  const[password,setPassword]=useState('');
  const[busy,setBusy]=useState(false);
  const[message,setMessage]=useState<string|undefined>(initialMessage);
  const[keyboardVisible,setKeyboardVisible]=useState(false);
  const passwordInput=useRef<TextInput>(null);
  const scrollView=useRef<ScrollView>(null);
  useEffect(()=>{if(initialMessage)setMessage(initialMessage)},[initialMessage]);
  useEffect(()=>{
    const show=Keyboard.addListener('keyboardDidShow',()=>setKeyboardVisible(true));
    const hide=Keyboard.addListener('keyboardDidHide',()=>setKeyboardVisible(false));
    return()=>{show.remove();hide.remove()};
  },[]);
  async function submit(create=false){
    Keyboard.dismiss();setBusy(true);setMessage(undefined);
    const result=create?await supabase.auth.signUp({email:email.trim(),password,options:{emailRedirectTo:authCallbackUrl}}):await supabase.auth.signInWithPassword({email:email.trim(),password});
    setBusy(false);
    if(result.error)setMessage(result.error.message);
    else if(create&&!result.data.session)setMessage('Check your inbox to confirm your account.');
  }
  const disabled=busy||!email.trim()||password.length<6;
  return <SafeAreaView style={styles.safe} edges={['top','right','bottom','left']}>
    <StatusBar style="light"/>
    <KeyboardAvoidingView style={styles.authKeyboard} behavior={Platform.OS==='ios'?'padding':undefined}>
      <ScrollView ref={scrollView} style={styles.authScroll} contentContainerStyle={[styles.authContent,keyboardVisible&&styles.authContentKeyboard]} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} showsVerticalScrollIndicator={false}>
        <View style={keyboardVisible?styles.heroKeyboard:styles.hero}>
          <Text style={styles.eyebrow}>TOOLED / VOICE</Text>
          <Text style={keyboardVisible?styles.titleKeyboard:styles.title}>{keyboardVisible?'Speak. Delegate. Done.':<>Speak.{`\n`}Delegate.{`\n`}Done.</>}</Text>
          {!keyboardVisible?<Text style={styles.intro}>A private voice line to your tools.</Text>:null}
        </View>
        <View style={styles.form}>
          <TextInput value={email} onChangeText={setEmail} onFocus={()=>requestAnimationFrame(()=>scrollView.current?.scrollToEnd({animated:true}))} autoCapitalize="none" autoCorrect={false} autoComplete="email" keyboardType="email-address" textContentType="emailAddress" returnKeyType="next" blurOnSubmit={false} onSubmitEditing={()=>passwordInput.current?.focus()} placeholder="EMAIL" placeholderTextColor="#77796e" style={styles.input} accessibilityLabel="Email address"/>
          <TextInput ref={passwordInput} value={password} onChangeText={setPassword} onFocus={()=>requestAnimationFrame(()=>scrollView.current?.scrollToEnd({animated:true}))} secureTextEntry autoComplete="password" textContentType="password" returnKeyType="go" onSubmitEditing={()=>{if(!disabled)void submit()}} placeholder="PASSWORD" placeholderTextColor="#77796e" style={styles.input} accessibilityLabel="Password"/>
          {message?<Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{message}</Text>:null}
          <Pressable disabled={disabled} onPress={()=>void submit()} style={({pressed})=>[styles.primary,disabled&&styles.primaryDisabled,pressed&&!disabled&&styles.pressed]} accessibilityRole="button" accessibilityLabel="Sign in">
            {busy?<ActivityIndicator color="#11130e"/>:<Text style={styles.primaryText}>ENTER VOICE LINK</Text>}
          </Pressable>
          <Pressable disabled={busy||!email.trim()||password.length<6} onPress={()=>void submit(true)} style={({pressed})=>pressed&&styles.pressed} accessibilityRole="button" accessibilityLabel="Create account"><Text style={styles.secondary}>CREATE ACCOUNT</Text></Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>
}

function VoiceScreen({email}:{email:string}){
  const voice=useVoiceSession();
  const history=useRef<ScrollView>(null);
  const[showDiagnostics,setShowDiagnostics]=useState(false);
  const active=['connected','listening','thinking','speaking'].includes(voice.state);
  const pending=['authenticating','connecting','reconnecting'].includes(voice.state);
  const liveLabel=voice.muted?'MUTED':voice.state==='listening'?'LISTENING':voice.state==='speaking'?'SPEAKING':voice.state==='thinking'?'THINKING':'LIVE';
  const metric=(event:string)=>voice.diagnostics.find(item=>item.event===event)?.elapsedMs;
  const metricValue=(event:string)=>{const value=metric(event);return value===undefined?'—':`${value}ms`};
  const labMetrics=[['CONNECTION',metricValue('channel_open')],['TURN RESPONSE',metricValue('response_created')],['FIRST AUDIO',metricValue('first_audio')],['LATEST TOOL',metricValue('tool_finished')],['INTERRUPTIONS',String(voice.diagnostics.filter(item=>item.event==='interruption_detected').length)]];
  return <SafeAreaView style={styles.safe}><StatusBar style="light"/>
    <View style={styles.header}><View><Text style={styles.eyebrow}>TOOLED / VOICE</Text><Text style={styles.identity}>{email}</Text></View><Pressable onPress={()=>void supabase.auth.signOut()}><Text style={styles.signout}>SIGN OUT</Text></Pressable></View>
    <View style={styles.statusRow}><View style={[styles.dot,{backgroundColor:voice.state==='error'?'#ff5d43':active?'#e8ff58':'#77796e'}]}/><Text style={styles.status}>{voice.muted&&active?'MUTED':labels[voice.state]}</Text><Pressable onPress={()=>setShowDiagnostics(value=>!value)} style={styles.labButton} accessibilityRole="button" accessibilityLabel="Toggle voice diagnostics"><Text style={styles.labButtonText}>VOICE LAB</Text></Pressable></View>
    {showDiagnostics?<View style={styles.diagnostics}><View style={styles.diagnosticsHeader}><Text style={styles.diagnosticsTitle}>VOICE LAB / LIVE</Text><Pressable onPress={()=>setShowDiagnostics(false)}><Text style={styles.diagnosticsClose}>CLOSE</Text></Pressable></View><Text style={styles.diagnosticsSummary}>ROUTE {voice.route.toUpperCase()}  ·  VAD {voice.vadEagerness.toUpperCase()}</Text><View style={styles.metricGrid}>{labMetrics.map(([label,value])=><View key={label} style={styles.metricCell}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>)}</View></View>:null}
    <ToolIntegrationControl/>
    {voice.mcpApproval?<View style={styles.approval} accessibilityLiveRegion="assertive"><Text style={styles.approvalEyebrow}>TOOL ACTION</Text><Text style={styles.approvalTitle}>{friendlyToolName(voice.mcpApproval.name)}</Text><Text style={styles.approvalBody}>{summarizeToolArguments(voice.mcpApproval.arguments)}</Text><View style={styles.approvalActions}><Pressable onPress={voice.rejectMcpAction} style={({pressed})=>[styles.approvalSecondary,pressed&&styles.pressed]} accessibilityRole="button" accessibilityLabel="Deny tool action"><Text style={styles.approvalSecondaryText}>DENY</Text></Pressable><Pressable onPress={voice.approveMcpAction} style={({pressed})=>[styles.approvalPrimary,pressed&&styles.pressed]} accessibilityRole="button" accessibilityLabel="Allow tool action"><Text style={styles.approvalPrimaryText}>ALLOW</Text></Pressable></View></View>:null}
    <ScrollView ref={history} style={styles.history} contentContainerStyle={styles.historyContent} onContentSizeChange={()=>history.current?.scrollToEnd({animated:true})}>
      {voice.history.length===0?<View style={styles.empty}><Text style={styles.emptyIndex}>01</Text><Text style={styles.emptyTitle}>{active?'Live line open.':'Start a live voice.'}{`\n`}{active?'Just start talking.':'Stay in the conversation.'}</Text><Text style={styles.emptyBody}>{active?'Speak naturally, pause when you are done, and interrupt at any time.':'Connect once for a continuous, hands-free conversation with your tools.'}</Text></View>:voice.history.map(item=><View key={item.id} style={[styles.line,item.role==='assistant'&&styles.assistant]}><Text style={styles.role}>{item.role==='user'?'YOU':'VOICE'}</Text><Text style={styles.transcript}>{item.text}</Text></View>)}
    </ScrollView>
    {voice.error?<Text style={styles.error}>{voice.error}</Text>:null}
    <View style={styles.controls}>{!active?<Pressable disabled={pending} onPress={()=>void voice.connect()} style={[styles.connect,pending&&styles.primaryDisabled]} accessibilityRole="button" accessibilityLabel="Start live voice"><Text style={styles.connectText}>{pending?'OPENING LIVE LINE…':'START LIVE VOICE'}</Text></Pressable>:<>
      <View style={[styles.liveOrb,voice.state==='speaking'&&styles.liveOrbSpeaking,voice.muted&&styles.liveOrbMuted]} accessibilityLiveRegion="polite"><View style={[styles.liveCore,voice.muted&&styles.liveCoreMuted]}><Text style={[styles.liveText,voice.muted&&styles.liveTextMuted]}>{liveLabel}</Text></View></View>
      <View style={styles.liveActions}><Pressable onPress={voice.toggleMuted} style={({pressed})=>[styles.liveAction,voice.muted&&styles.liveActionActive,pressed&&styles.pressed]} accessibilityRole="button" accessibilityLabel={voice.muted?'Unmute microphone':'Mute microphone'}><Text style={[styles.liveActionText,voice.muted&&styles.liveActionTextActive]}>{voice.muted?'UNMUTE':'MUTE'}</Text></Pressable><Pressable onPress={voice.toggleSpeaker} style={({pressed})=>[styles.liveAction,voice.speaker&&styles.liveActionActive,pressed&&styles.pressed]} accessibilityRole="button" accessibilityLabel={voice.speaker?'Use earpiece':'Use speaker'}><Text style={[styles.liveActionText,voice.speaker&&styles.liveActionTextActive]}>{voice.speaker?'SPEAKER':'EARPIECE'}</Text></Pressable><Pressable onPress={voice.disconnect} style={({pressed})=>[styles.liveAction,styles.endAction,pressed&&styles.pressed]} accessibilityRole="button" accessibilityLabel="End live voice session"><Text style={styles.endActionText}>END</Text></Pressable></View>
      <Pressable onPress={voice.toggleVadEagerness} accessibilityRole="button" accessibilityLabel="Toggle voice response speed"><Text style={styles.vadToggle}>TURN SPEED · {voice.vadEagerness==='high'?'FAST':'NATURAL'}</Text></Pressable>
    </>}<Text style={styles.hint}>{active?(voice.muted?'MICROPHONE OFF · TAP UNMUTE TO CONTINUE':'LIVE MIC · SPEAK NATURALLY · INTERRUPT ANY TIME'):'ONE CONNECTION · CONTINUOUS CONVERSATION'}</Text></View>
  </SafeAreaView>
}

const ink='#f0f1e8',base='#11130e',acid='#e8ff58',muted='#9b9d91';
const styles=StyleSheet.create({
  safe:{flex:1,backgroundColor:base,paddingHorizontal:22},
  loading:{flex:1,backgroundColor:base,alignItems:'center',justifyContent:'center'},
  authKeyboard:{flex:1},
  authScroll:{flex:1},
  authContent:{flexGrow:1,justifyContent:'space-between',paddingTop:52,paddingBottom:24},
  authContentKeyboard:{justifyContent:'flex-start',paddingTop:14,paddingBottom:16,gap:18},
  hero:{flexShrink:0},
  heroKeyboard:{flexShrink:0,borderBottomWidth:1,borderColor:'#303229',paddingBottom:16},
  eyebrow:{color:acid,fontSize:11,fontWeight:'800',letterSpacing:2.8},
  title:{color:ink,fontSize:56,lineHeight:56,fontWeight:'900',letterSpacing:-2,marginTop:24},
  titleKeyboard:{color:ink,fontSize:25,lineHeight:30,fontWeight:'900',letterSpacing:-0.8,marginTop:8},
  intro:{color:muted,fontSize:17,marginTop:18},
  form:{gap:12,flexShrink:0},
  input:{height:54,borderBottomWidth:1,borderColor:'#5a5c52',color:ink,fontSize:16,letterSpacing:1.3,paddingHorizontal:0},
  primary:{height:56,backgroundColor:acid,alignItems:'center',justifyContent:'center',marginTop:10},
  primaryDisabled:{opacity:.38},
  primaryText:{color:base,fontSize:13,fontWeight:'900',letterSpacing:1.6},
  secondary:{color:ink,textAlign:'center',fontSize:12,fontWeight:'700',letterSpacing:1.5,padding:11},
  pressed:{opacity:.72},
  error:{color:'#ff765f',fontSize:13,lineHeight:18},
  header:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',paddingTop:22},
  identity:{color:muted,fontSize:11,marginTop:8},
  signout:{color:muted,fontSize:10,fontWeight:'700',letterSpacing:1.2},
  statusRow:{flexDirection:'row',alignItems:'center',gap:9,marginTop:34},
  dot:{width:8,height:8,borderRadius:4},
  status:{color:ink,fontSize:12,fontWeight:'800',letterSpacing:2},
  labButton:{marginLeft:'auto',borderWidth:1,borderColor:'#5a5c52',paddingHorizontal:9,paddingVertical:5},
  labButtonText:{color:muted,fontSize:8,fontWeight:'900',letterSpacing:1.2},
  diagnostics:{position:'absolute',top:118,left:14,right:14,zIndex:10,backgroundColor:'#191b15',borderWidth:1,borderColor:acid,padding:14,shadowColor:'#000',shadowOpacity:.7,shadowRadius:18,elevation:12},
  diagnosticsHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  diagnosticsTitle:{color:acid,fontSize:10,fontWeight:'900',letterSpacing:1.6},
  diagnosticsClose:{color:muted,fontSize:8,fontWeight:'800',letterSpacing:1.2,padding:5},
  diagnosticsSummary:{color:ink,fontSize:9,fontWeight:'800',letterSpacing:1,marginTop:9,marginBottom:7},
  metricGrid:{flexDirection:'row',flexWrap:'wrap',borderTopWidth:1,borderLeftWidth:1,borderColor:'#303229'},
  metricCell:{width:'50%',borderRightWidth:1,borderBottomWidth:1,borderColor:'#303229',padding:10},
  metricLabel:{color:muted,fontSize:8,fontWeight:'800',letterSpacing:.8},
  metricValue:{color:ink,fontSize:17,fontWeight:'800',marginTop:4},
  approval:{position:'absolute',top:150,left:14,right:14,zIndex:12,backgroundColor:'#191b15',borderWidth:1,borderColor:acid,padding:18,shadowColor:'#000',shadowOpacity:.75,shadowRadius:20,elevation:14},
  approvalEyebrow:{color:acid,fontSize:9,fontWeight:'900',letterSpacing:2},
  approvalTitle:{color:ink,fontSize:24,lineHeight:29,fontWeight:'900',marginTop:10},
  approvalBody:{color:muted,fontSize:14,lineHeight:20,marginTop:8},
  approvalActions:{flexDirection:'row',gap:10,marginTop:18},
  approvalSecondary:{flex:1,height:48,borderWidth:1,borderColor:'#74443c',alignItems:'center',justifyContent:'center'},
  approvalSecondaryText:{color:'#ff765f',fontSize:11,fontWeight:'900',letterSpacing:1.5},
  approvalPrimary:{flex:1,height:48,backgroundColor:acid,alignItems:'center',justifyContent:'center'},
  approvalPrimaryText:{color:base,fontSize:11,fontWeight:'900',letterSpacing:1.5},
  history:{flex:1,marginTop:10},
  historyContent:{flexGrow:1,paddingVertical:24},
  empty:{flex:1,justifyContent:'center',borderTopWidth:1,borderColor:'#303229'},
  emptyIndex:{color:acid,fontSize:12,fontWeight:'800'},
  emptyTitle:{color:ink,fontSize:38,lineHeight:41,fontWeight:'800',letterSpacing:-1.1,marginTop:14},
  emptyBody:{color:muted,fontSize:14,lineHeight:21,maxWidth:290,marginTop:18},
  line:{borderTopWidth:1,borderColor:'#303229',paddingVertical:20,paddingRight:34},
  assistant:{paddingLeft:28},
  role:{color:acid,fontSize:9,fontWeight:'900',letterSpacing:2,marginBottom:8},
  transcript:{color:ink,fontSize:18,lineHeight:27},
  controls:{alignItems:'center',paddingBottom:22},
  connect:{width:'100%',height:64,borderWidth:1,borderColor:acid,alignItems:'center',justifyContent:'center'},
  connectText:{color:acid,fontWeight:'900',letterSpacing:2},
  liveOrb:{width:126,height:126,borderRadius:63,borderWidth:1,borderColor:acid,alignItems:'center',justifyContent:'center'},
  liveOrbSpeaking:{borderWidth:4},
  liveOrbMuted:{borderColor:'#5a5c52'},
  liveCore:{width:98,height:98,borderRadius:49,backgroundColor:acid,alignItems:'center',justifyContent:'center'},
  liveCoreMuted:{backgroundColor:'#303229'},
  liveText:{color:base,fontSize:12,fontWeight:'900',letterSpacing:1.7},
  liveTextMuted:{color:muted},
  liveActions:{flexDirection:'row',gap:8,marginTop:14,width:'100%'},
  liveAction:{height:42,flex:1,borderWidth:1,borderColor:'#5a5c52',alignItems:'center',justifyContent:'center',paddingHorizontal:6},
  liveActionActive:{borderColor:acid},
  liveActionText:{color:ink,fontSize:10,fontWeight:'900',letterSpacing:1.5},
  liveActionTextActive:{color:acid},
  endAction:{borderColor:'#74443c'},
  endActionText:{color:'#ff765f',fontSize:10,fontWeight:'900',letterSpacing:1.5},
  vadToggle:{color:'#77796e',fontSize:8,fontWeight:'800',letterSpacing:1.1,paddingTop:12},
  hint:{color:'#77796e',fontSize:9,fontWeight:'700',letterSpacing:1.1,marginTop:16},
});

function friendlyToolName(name:string){return name.replace(/_/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase())}
function summarizeToolArguments(raw:string){try{const value=JSON.parse(raw) as Record<string,unknown>;const summary=Object.entries(value).slice(0,4).map(([key,item])=>`${friendlyToolName(key)}: ${typeof item==='string'?item:JSON.stringify(item)}`).join('\n');return summary||'Allow this change in your Linear workspace?'}catch{return 'Allow this change in your Linear workspace?'}}
