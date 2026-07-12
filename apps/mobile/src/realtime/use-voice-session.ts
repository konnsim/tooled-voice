import { useCallback,useEffect,useRef,useState } from 'react';
import { AppState } from 'react-native';
import type { ConnectionState } from '@tooled-voice/shared';
import { getLatestConversation } from '../api/client';
import { RealtimeClient } from './realtime-client';
export interface Transcript {id:string;role:'user'|'assistant';text:string}
type ClientEvent=Parameters<ConstructorParameters<typeof RealtimeClient>[0]>[0];
export function useVoiceSession(){
  const[state,setState]=useState<ConnectionState>('idle');
  const[history,setHistory]=useState<Transcript[]>([]);
  const[error,setError]=useState<string>();
  const listener=useRef<(event:ClientEvent)=>void>(()=>undefined);
  const client=useRef<RealtimeClient|undefined>(undefined);
  const mounted=useRef(true);
  const shouldReconnect=useRef(false);
  listener.current=(event:ClientEvent)=>{
    if(!mounted.current)return;
    if(event.state){setState(event.state);if(['connected','listening','thinking','speaking','reconnecting'].includes(event.state))shouldReconnect.current=true}
    if(event.error)setError(event.error);
    if(event.transcript)setHistory(items=>[...items,{id:`${Date.now()}-${items.length}`,...event.transcript!}]);
  };
  client.current??=new RealtimeClient(event=>listener.current(event));
  useEffect(()=>{
    mounted.current=true;
    let disposed=false;
    void getLatestConversation().then(latest=>{
      if(disposed)return;
      if(latest)setHistory(latest.items.filter((item):item is typeof item&{role:'user'|'assistant';transcript:string}=>item.kind==='transcript'&&item.transcript!==null&&(item.role==='user'||item.role==='assistant')).map(item=>({id:item.id,role:item.role,text:item.transcript})));
      if(latest)client.current?.useConversationIfUnset(latest.id);
    }).catch(()=>undefined);
    const subscription=AppState.addEventListener('change',next=>{
      if(next!=='active'){if(shouldReconnect.current)client.current?.disconnect()}
      else if(shouldReconnect.current)void client.current?.connect(true);
    });
    return()=>{disposed=true;mounted.current=false;subscription.remove();client.current?.disconnect()};
  },[]);
  const connect=useCallback(async()=>{setError(undefined);setState('authenticating');await client.current?.connect()},[]);
  return{state,history,error,connect,disconnect:()=>client.current?.disconnect(),startTalking:()=>client.current?.startTalking(),stopTalking:()=>client.current?.stopTalking()};
}
