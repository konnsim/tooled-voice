import InCallManager from 'react-native-incall-manager';
import { DeviceEventEmitter,PermissionsAndroid,Platform,type EmitterSubscription } from 'react-native';

export type AudioRoute='speaker'|'earpiece'|'external';
export type AudioSessionEvent={event:string;detail?:string;route?:AudioRoute};

let subscriptions:EmitterSubscription[]=[];

export async function startAudioSession(listener:(event:AudioSessionEvent)=>void){
  stopAudioSession();
  if(Platform.OS==='android'&&Number(Platform.Version)>=31){
    const permission=PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
    const result=await PermissionsAndroid.check(permission)?PermissionsAndroid.RESULTS.GRANTED:await PermissionsAndroid.request(permission,{title:'Bluetooth audio',message:'Allow Tooled Voice to use connected Bluetooth headsets during live voice.',buttonPositive:'Allow',buttonNegative:'Not now'});
    listener({event:'bluetooth_permission',detail:result});
  }
  subscriptions=[
    DeviceEventEmitter.addListener('WiredHeadset',(data:{isPlugged?:boolean;deviceName?:string})=>listener({event:'audio_route_changed',detail:data.deviceName??(data.isPlugged?'external':'speaker'),route:data.isPlugged?'external':'speaker'})),
    DeviceEventEmitter.addListener('NoisyAudio',()=>listener({event:'audio_route_noisy'})),
    DeviceEventEmitter.addListener('onAudioFocusChange',(data:{eventText?:string;eventCode?:number})=>listener({event:'audio_focus_changed',detail:data.eventText??String(data.eventCode??'unknown')})),
  ];
  InCallManager.start({media:'video',auto:true});
  InCallManager.setKeepScreenOn(true);
  listener({event:'audio_session_started',detail:'communication/speaker',route:'speaker'});
}

export function setSpeakerRoute(speaker:boolean,listener:(event:AudioSessionEvent)=>void){
  InCallManager.setForceSpeakerphoneOn(speaker);
  listener({event:'audio_route_selected',detail:speaker?'speaker':'earpiece',route:speaker?'speaker':'earpiece'});
}

export function stopAudioSession(){
  subscriptions.forEach(subscription=>subscription.remove());
  subscriptions=[];
  try{InCallManager.setKeepScreenOn(false);InCallManager.stop()}catch{}
}
