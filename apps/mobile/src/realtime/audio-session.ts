import {
  DeviceEventEmitter,
  type EmitterSubscription,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import InCallManager from 'react-native-incall-manager';

export type AudioRoute = 'speaker' | 'earpiece' | 'external';
export type AudioSessionEvent = {
  event: string;
  detail?: string;
  route?: AudioRoute;
};

let subscriptions: EmitterSubscription[] = [];

export async function startAudioSession(
  listener: (event: AudioSessionEvent) => void
) {
  stopAudioSession();
  if (Platform.OS === 'android' && Number(Platform.Version) >= 31) {
    const permission = PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT;
    const result = (await PermissionsAndroid.check(permission))
      ? PermissionsAndroid.RESULTS.GRANTED
      : await PermissionsAndroid.request(permission, {
          buttonNegative: 'Not now',
          buttonPositive: 'Allow',
          message:
            'Allow Tooled Voice to use connected Bluetooth headsets during live voice.',
          title: 'Bluetooth audio',
        });
    listener({ detail: result, event: 'bluetooth_permission' });
  }
  subscriptions = [
    DeviceEventEmitter.addListener(
      'WiredHeadset',
      (data: { isPlugged?: boolean; deviceName?: string }) =>
        listener({
          detail: data.deviceName ?? (data.isPlugged ? 'external' : 'speaker'),
          event: 'audio_route_changed',
          route: data.isPlugged ? 'external' : 'speaker',
        })
    ),
    DeviceEventEmitter.addListener('NoisyAudio', () =>
      listener({ event: 'audio_route_noisy' })
    ),
    DeviceEventEmitter.addListener(
      'onAudioFocusChange',
      (data: { eventText?: string; eventCode?: number }) =>
        listener({
          detail: data.eventText ?? String(data.eventCode ?? 'unknown'),
          event: 'audio_focus_changed',
        })
    ),
  ];
  InCallManager.start({ auto: true, media: 'video' });
  InCallManager.setKeepScreenOn(true);
  listener({
    detail: 'communication/speaker',
    event: 'audio_session_started',
    route: 'speaker',
  });
}

export function setSpeakerRoute(
  speaker: boolean,
  listener: (event: AudioSessionEvent) => void
) {
  InCallManager.setForceSpeakerphoneOn(speaker);
  listener({
    detail: speaker ? 'speaker' : 'earpiece',
    event: 'audio_route_selected',
    route: speaker ? 'speaker' : 'earpiece',
  });
}

export function stopAudioSession() {
  subscriptions.forEach((subscription) => {
    subscription.remove();
  });
  subscriptions = [];
  try {
    InCallManager.setKeepScreenOn(false);
    InCallManager.stop();
  } catch {}
}
