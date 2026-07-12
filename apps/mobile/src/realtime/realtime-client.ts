import { RTCPeerConnection, RTCSessionDescription, mediaDevices, type MediaStream, type MediaStreamTrack } from 'react-native-webrtc';
import type { ConnectionState } from '@tooled-voice/shared';
import { ApiClientError,createRealtimeCredential, executeTool,finishConversation, persistConversationItem } from '../api/client';
type Listener=(event:{state?:ConnectionState;transcript?:{id:string;role:'user'|'assistant';text:string;final:boolean};error?:string})=>void;
type Events={addEventListener(type:string,listener:(event:any)=>void):void};
type Channel=Events&{readyState:string;send(data:string):void;close():void};
export class RealtimeClient {
  private pc:RTCPeerConnection|undefined; private channel:Channel|undefined; private stream:MediaStream|undefined; private microphone:MediaStreamTrack|undefined; private remote:MediaStream|undefined; private conversationId:string|undefined; private closed=false; private retries=0; private responseActive=false; private reconnecting=false; private openTimer:ReturnType<typeof setTimeout>|undefined;private readonly streamingTranscripts=new Map<string,string>();
  constructor(private readonly listener:Listener,conversationId?:string) {this.conversationId=conversationId}
  useConversationIfUnset(conversationId:string){this.conversationId??=conversationId}
  private state(state:ConnectionState){this.listener({state})}
  async connect(reconnecting=false):Promise<void>{
    this.closed=false;if(reconnecting)this.state('reconnecting');
    try {
      const credential=await createRealtimeCredential(this.conversationId); this.conversationId=credential.conversationId;
      this.state('connecting');
      const stream=await mediaDevices.getUserMedia({audio:true,video:false});
      this.stream=stream;
      const microphone=stream.getAudioTracks()[0]; if(!microphone)throw new Error('MICROPHONE_UNAVAILABLE'); microphone.enabled=false;this.microphone=microphone;
      const pc=new RTCPeerConnection();this.pc=pc;stream.getTracks().forEach(track=>pc.addTrack(track,stream));
      const pcEvents=pc as unknown as Events;
      pcEvents.addEventListener('track',event=>{this.remote=event.streams?.[0]});
      pcEvents.addEventListener('connectionstatechange',()=>{if(this.pc===pc&&['failed','disconnected'].includes(pc.connectionState))void this.reconnect()});
      const channel=pc.createDataChannel('oai-events') as unknown as Channel;this.channel=channel;
      channel.addEventListener('message',event=>void this.onEvent(event.data)); channel.addEventListener('open',()=>{if(this.openTimer)clearTimeout(this.openTimer);this.openTimer=undefined;this.retries=0;this.state('connected')}); channel.addEventListener('error',()=>{if(this.channel===channel)void this.reconnect()});channel.addEventListener('close',()=>{if(this.channel===channel)void this.reconnect()});
      const offer=await pc.createOffer({offerToReceiveAudio:true}); await pc.setLocalDescription(offer);
      const response=await fetch('https://api.openai.com/v1/realtime/calls',{method:'POST',headers:{Authorization:`Bearer ${credential.clientSecret}`,'Content-Type':'application/sdp'},body:offer.sdp});
      if(!response.ok)throw new Error(`WEBRTC_NEGOTIATION_${response.status}`);
      await pc.setRemoteDescription(new RTCSessionDescription({type:'answer',sdp:await response.text()}));
      this.openTimer=setTimeout(()=>{if(channel.readyState!=='open')void this.reconnect()},15_000);
    } catch(error){this.cleanup(false);if(isRetryableConnectionError(error)&&this.retries<4&&!this.closed)return this.retry();this.fail(error instanceof Error?error.message:'CONNECTION_FAILED')}
  }
  startTalking(){if(!this.microphone||this.channel?.readyState!=='open')return;if(this.responseActive){this.send({type:'response.cancel'});this.send({type:'output_audio_buffer.clear'});this.responseActive=false}this.microphone.enabled=true;this.state('listening')}
  stopTalking(){if(!this.microphone)return;this.microphone.enabled=false;this.send({type:'input_audio_buffer.commit'});this.send({type:'response.create'});this.state('thinking')}
  private send(event:Record<string,unknown>){if(this.channel?.readyState==='open')this.channel.send(JSON.stringify(event))}
  private persist(item:Parameters<typeof persistConversationItem>[1]){if(this.conversationId)void persistConversationItem(this.conversationId,item).catch(()=>this.listener({error:'HISTORY_PERSIST_FAILED'}))}
  private async onEvent(raw:unknown){if(typeof raw!=='string')return;let event:any;try{event=JSON.parse(raw)}catch{return}if(!event||typeof event.type!=='string')return;switch(event.type){case'input_audio_buffer.speech_started':this.state('listening');break;case'conversation.item.input_audio_transcription.delta':this.transcriptDelta(event,'user');break;case'conversation.item.input_audio_transcription.completed':this.transcriptDone(event,'user');break;case'conversation.item.input_audio_transcription.failed':this.listener({error:typeof event.error?.code==='string'?event.error.code:'TRANSCRIPTION_FAILED'});break;case'response.created':this.responseActive=true;this.state('thinking');break;case'response.audio.delta':case'response.output_audio.delta':this.state('speaking');break;case'response.output_audio_transcript.delta':this.transcriptDelta(event,'assistant');break;case'response.audio_transcript.done':case'response.output_audio_transcript.done':this.transcriptDone(event,'assistant');break;case'response.done':this.responseActive=false;this.state('connected');break;case'response.function_call_arguments.done':await this.handleTool(event);break;case'error':this.listener({error:typeof event.error?.code==='string'?event.error.code:'REALTIME_ERROR'});break}}
  private transcriptDelta(event:any,role:'user'|'assistant'){if(typeof event.item_id!=='string'||typeof event.delta!=='string')return;const text=(this.streamingTranscripts.get(event.item_id)??'')+event.delta;this.streamingTranscripts.set(event.item_id,text);this.listener({transcript:{id:event.item_id,role,text,final:false}})}
  private transcriptDone(event:any,role:'user'|'assistant'){if(typeof event.item_id!=='string'||typeof event.transcript!=='string')return;this.streamingTranscripts.delete(event.item_id);this.listener({transcript:{id:event.item_id,role,text:event.transcript,final:true}});this.persist({role,kind:'transcript',transcript:event.transcript})}
  private async handleTool(event:any){if(typeof event.call_id!=='string'||typeof event.name!=='string'||typeof event.arguments!=='string')return;this.state('thinking');let args:unknown;try{args=JSON.parse(event.arguments)}catch{args=null}this.persist({role:'tool',kind:'tool_call',callId:event.call_id,payload:{tool:event.name,arguments:args}});let output:unknown;try{output=await executeTool({callId:event.call_id,tool:event.name,arguments:args,...(this.conversationId?{conversationId:this.conversationId}:{})})}catch(error){output={ok:false,callId:event.call_id,error:{code:error instanceof ApiClientError?error.code:'TOOL_BRIDGE_FAILED',message:error instanceof ApiClientError?error.message:'The tool request failed',retryable:error instanceof ApiClientError&&error.retryable}}}this.persist({role:'tool',kind:'tool_result',callId:event.call_id,payload:output});this.send({type:'conversation.item.create',item:{type:'function_call_output',call_id:event.call_id,output:JSON.stringify(output)}});this.send({type:'response.create'})}
  private async retry(){this.retries++;this.state('reconnecting');await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**(this.retries-1),8000)+Math.random()*250));if(!this.closed)await this.connect(true)}
  private async reconnect(){if(this.closed||this.reconnecting)return;if(this.retries>=4){this.fail('RECONNECT_EXHAUSTED');return}this.reconnecting=true;this.cleanup(false);try{await this.retry()}finally{this.reconnecting=false}}
  disconnect(complete=false){this.closed=true;this.cleanup(true);if(complete&&this.conversationId){void finishConversation(this.conversationId,'completed').catch(()=>this.listener({error:'HISTORY_PERSIST_FAILED'}));this.conversationId=undefined}this.state('disconnected')}
  private fail(message:string){this.state('error');this.listener({error:message});if(this.conversationId)void finishConversation(this.conversationId,'failed').catch(()=>undefined)}
  private cleanup(stop=true){if(this.openTimer)clearTimeout(this.openTimer);this.openTimer=undefined;const channel=this.channel;this.channel=undefined;try{channel?.close()}catch{}const pc=this.pc;this.pc=undefined;try{pc?.close()}catch{}this.stream?.getTracks().forEach(track=>{try{track.stop()}catch{}});this.remote?.getTracks().forEach(track=>{try{track.stop()}catch{}});this.stream=undefined;this.microphone=undefined;this.remote=undefined;this.streamingTranscripts.clear();if(stop)this.responseActive=false}
}
function isRetryableConnectionError(error:unknown){const value=error instanceof Error?`${error.name}:${error.message}`:String(error);return !/MICROPHONE|PERMISSION|NOT.?ALLOWED|AUTH_REQUIRED|AUTH_INVALID/i.test(value)}
