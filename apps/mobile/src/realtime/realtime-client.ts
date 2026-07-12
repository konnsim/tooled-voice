import { RTCPeerConnection, RTCSessionDescription, mediaDevices, type MediaStream, type MediaStreamTrack } from 'react-native-webrtc';
import type { ConnectionState } from '@tooled-voice/shared';
import { createRealtimeCredential, executeTool, persistConversationItem } from '../api/client';
type Listener=(event:{state?:ConnectionState;transcript?:{role:'user'|'assistant';text:string};error?:string})=>void;
type Events={addEventListener(type:string,listener:(event:any)=>void):void};
type Channel=Events&{readyState:string;send(data:string):void;close():void};
export class RealtimeClient {
  private pc:RTCPeerConnection|undefined; private channel:Channel|undefined; private stream:MediaStream|undefined; private microphone:MediaStreamTrack|undefined; private remote:MediaStream|undefined; private conversationId:string|undefined; private closed=false; private retries=0; private responseActive=false;
  constructor(private readonly listener:Listener,conversationId?:string) {this.conversationId=conversationId}
  useConversationIfUnset(conversationId:string){this.conversationId??=conversationId}
  private state(state:ConnectionState){this.listener({state})}
  async connect(reconnecting=false):Promise<void>{
    this.closed=false;this.state(reconnecting?'reconnecting':'connecting');
    try {
      const credential=await createRealtimeCredential(this.conversationId); this.conversationId=credential.conversationId;
      const stream=await mediaDevices.getUserMedia({audio:true,video:false});
      const microphone=stream.getAudioTracks()[0]; if(!microphone)throw new Error('MICROPHONE_UNAVAILABLE'); microphone.enabled=false;
      const pc=new RTCPeerConnection(); stream.getTracks().forEach(track=>pc.addTrack(track,stream));
      const pcEvents=pc as unknown as Events;
      pcEvents.addEventListener('track',event=>{this.remote=event.streams?.[0]});
      pcEvents.addEventListener('connectionstatechange',()=>{if(['failed','disconnected'].includes(pc.connectionState))void this.reconnect()});
      const channel=pc.createDataChannel('oai-events') as unknown as Channel;
      channel.addEventListener('message',event=>void this.onEvent(event.data)); channel.addEventListener('open',()=>{this.retries=0;this.state('connected')}); channel.addEventListener('error',()=>void this.reconnect());
      const offer=await pc.createOffer({offerToReceiveAudio:true}); await pc.setLocalDescription(offer);
      const response=await fetch('https://api.openai.com/v1/realtime/calls',{method:'POST',headers:{Authorization:`Bearer ${credential.clientSecret}`,'Content-Type':'application/sdp'},body:offer.sdp});
      if(!response.ok)throw new Error(`WEBRTC_NEGOTIATION_${response.status}`);
      await pc.setRemoteDescription(new RTCSessionDescription({type:'answer',sdp:await response.text()}));
      this.pc=pc;this.channel=channel;this.stream=stream;this.microphone=microphone;
    } catch(error){this.cleanup(false);if(this.retries<4&&!this.closed)return this.retry();this.state('error');this.listener({error:error instanceof Error?error.message:'CONNECTION_FAILED'})}
  }
  startTalking(){if(!this.microphone||this.channel?.readyState!=='open')return;if(this.responseActive){this.send({type:'response.cancel'});this.send({type:'output_audio_buffer.clear'});this.responseActive=false}this.microphone.enabled=true;this.state('listening')}
  stopTalking(){if(!this.microphone)return;this.microphone.enabled=false;this.send({type:'input_audio_buffer.commit'});this.send({type:'response.create'});this.state('thinking')}
  private send(event:Record<string,unknown>){if(this.channel?.readyState==='open')this.channel.send(JSON.stringify(event))}
  private persist(item:Parameters<typeof persistConversationItem>[1]){if(this.conversationId)void persistConversationItem(this.conversationId,item).catch(()=>this.listener({error:'HISTORY_PERSIST_FAILED'}))}
  private async onEvent(raw:unknown){if(typeof raw!=='string')return;let event:any;try{event=JSON.parse(raw)}catch{return}if(!event||typeof event.type!=='string')return;switch(event.type){case'input_audio_buffer.speech_started':this.state('listening');break;case'conversation.item.input_audio_transcription.completed':if(typeof event.transcript==='string'){this.listener({transcript:{role:'user',text:event.transcript}});this.persist({role:'user',kind:'transcript',transcript:event.transcript})}break;case'response.created':this.responseActive=true;this.state('thinking');break;case'response.audio.delta':case'response.output_audio.delta':this.state('speaking');break;case'response.audio_transcript.done':case'response.output_audio_transcript.done':if(typeof event.transcript==='string'){this.listener({transcript:{role:'assistant',text:event.transcript}});this.persist({role:'assistant',kind:'transcript',transcript:event.transcript})}break;case'response.done':this.responseActive=false;this.state('connected');break;case'response.function_call_arguments.done':await this.handleTool(event);break;case'error':this.listener({error:typeof event.error?.code==='string'?event.error.code:'REALTIME_ERROR'});break}}
  private async handleTool(event:any){if(typeof event.call_id!=='string'||typeof event.name!=='string'||typeof event.arguments!=='string')return;this.state('thinking');let args:unknown;try{args=JSON.parse(event.arguments)}catch{args=null}this.persist({role:'tool',kind:'tool_call',callId:event.call_id,payload:{tool:event.name,arguments:args}});let output:unknown;try{output=await executeTool({callId:event.call_id,tool:event.name,arguments:args,...(this.conversationId?{conversationId:this.conversationId}:{})})}catch(error){output={ok:false,callId:event.call_id,error:{code:error instanceof Error?error.message:'TOOL_BRIDGE_FAILED',message:'The tool request failed',retryable:false}}}this.persist({role:'tool',kind:'tool_result',callId:event.call_id,payload:output});this.send({type:'conversation.item.create',item:{type:'function_call_output',call_id:event.call_id,output:JSON.stringify(output)}});this.send({type:'response.create'})}
  private async retry(){this.retries++;this.state('reconnecting');await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**(this.retries-1),8000)+Math.random()*250));if(!this.closed)await this.connect(true)}
  private async reconnect(){if(this.closed||this.retries>=4)return;this.cleanup(false);await this.retry()}
  disconnect(){this.closed=true;this.cleanup(true);this.state('disconnected')}
  private cleanup(stop=true){try{this.channel?.close()}catch{}try{this.pc?.close()}catch{}this.stream?.getTracks().forEach(track=>{try{track.stop()}catch{}});this.remote?.getTracks().forEach(track=>{try{track.stop()}catch{}});this.channel=undefined;this.pc=undefined;this.stream=undefined;this.microphone=undefined;this.remote=undefined;if(stop)this.responseActive=false}
}
