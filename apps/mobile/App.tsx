import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { authCallbackUrl, subscribeToAuthDeepLinks } from './src/auth/deep-link';
import { supabase } from './src/auth/supabase';
import { LinearIntegrationControl } from './src/integrations/linear-control';
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

function VoiceScreen({email}:{email:string}){const voice=useVoiceSession();const active=['connected','listening','thinking','speaking'].includes(voice.state);const pending=['authenticating','connecting','reconnecting'].includes(voice.state);return <SafeAreaView style={styles.safe}><StatusBar style="light"/><View style={styles.header}><View><Text style={styles.eyebrow}>TOOLED / VOICE</Text><Text style={styles.identity}>{email}</Text></View><Pressable onPress={()=>void supabase.auth.signOut()}><Text style={styles.signout}>SIGN OUT</Text></Pressable></View><View style={styles.statusRow}><View style={[styles.dot,{backgroundColor:voice.state==='error'?'#ff5d43':active?'#e8ff58':'#77796e'}]}/><Text style={styles.status}>{labels[voice.state]}</Text></View><LinearIntegrationControl/><ScrollView style={styles.history} contentContainerStyle={styles.historyContent}>{voice.history.length===0?<View style={styles.empty}><Text style={styles.emptyIndex}>01</Text><Text style={styles.emptyTitle}>Hold the signal.{`\n`}Say what you need.</Text><Text style={styles.emptyBody}>Ask for the current time or create a Linear issue to test the complete tool path.</Text></View>:voice.history.map(item=><View key={item.id} style={[styles.line,item.role==='assistant'&&styles.assistant]}><Text style={styles.role}>{item.role==='user'?'YOU':'VOICE'}</Text><Text style={styles.transcript}>{item.text}</Text></View>)}</ScrollView>{voice.error?<Text style={styles.error}>{voice.error}</Text>:null}<View style={styles.controls}>{!active?<Pressable disabled={pending} onPress={()=>void voice.connect()} style={[styles.connect,pending&&styles.primaryDisabled]}><Text style={styles.connectText}>{pending?'LINKING…':'CONNECT'}</Text></Pressable>:<><Pressable onPressIn={voice.startTalking} onPressOut={voice.stopTalking} accessibilityRole="button" accessibilityLabel="Hold to talk" style={({pressed})=>[styles.talk,pressed&&styles.talkPressed]}><View style={styles.talkCore}><Text style={styles.talkText}>{voice.state==='listening'?'RELEASE':'HOLD'}</Text></View></Pressable><Pressable onPress={voice.disconnect} accessibilityRole="button" accessibilityLabel="End voice session"><Text style={styles.endSession}>END SESSION</Text></Pressable></>}<Text style={styles.hint}>{active?'HOLD TO SPEAK · RELEASE TO SEND':'ESTABLISH A SECURE REALTIME SESSION'}</Text></View></SafeAreaView>}

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
  talk:{width:142,height:142,borderRadius:71,borderWidth:1,borderColor:'#626557',alignItems:'center',justifyContent:'center'},
  talkPressed:{borderColor:acid,transform:[{scale:.96}]},
  talkCore:{width:112,height:112,borderRadius:56,backgroundColor:acid,alignItems:'center',justifyContent:'center'},
  talkText:{color:base,fontSize:14,fontWeight:'900',letterSpacing:2},
  hint:{color:'#77796e',fontSize:9,fontWeight:'700',letterSpacing:1.1,marginTop:16},
  endSession:{color:'#9b9d91',fontSize:9,fontWeight:'800',letterSpacing:1.4,padding:10,marginTop:3},
});
