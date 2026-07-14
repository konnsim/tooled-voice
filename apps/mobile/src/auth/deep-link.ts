import { Linking } from 'react-native';
import { supabase } from './supabase';

export const authCallbackUrl = 'tooledvoice://auth/callback';

const exchangedCodes = new Set<string>();

export async function handleAuthDeepLink(url: string): Promise<void> {
  const callback = new URL(url);
  if (
    callback.protocol !== 'tooledvoice:' ||
    callback.hostname !== 'auth' ||
    callback.pathname !== '/callback'
  )
    return;

  const errorDescription = callback.searchParams.get('error_description');
  if (errorDescription) throw new Error(errorDescription);

  const code = callback.searchParams.get('code');
  if (!code || exchangedCodes.has(code)) return;
  exchangedCodes.add(code);

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    exchangedCodes.delete(code);
    throw error;
  }
}

export function subscribeToAuthDeepLinks(
  onError: (message: string) => void
): () => void {
  const open = (url: string) => {
    void handleAuthDeepLink(url).catch((error) =>
      onError(
        error instanceof Error
          ? error.message
          : 'Could not confirm your account.'
      )
    );
  };
  void Linking.getInitialURL()
    .then((url) => {
      if (url) open(url);
    })
    .catch((error) =>
      onError(
        error instanceof Error
          ? error.message
          : 'Could not open the confirmation link.'
      )
    );
  const subscription = Linking.addEventListener('url', (event) =>
    open(event.url)
  );
  return () => subscription.remove();
}
