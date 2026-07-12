import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import { createClient, processLock } from '@supabase/supabase-js';
import { config } from '../config';
import { secureSessionStorage } from './secure-session-storage';
export const supabase=createClient(config.supabaseUrl,config.supabaseKey,{auth:{storage:secureSessionStorage,autoRefreshToken:true,persistSession:true,detectSessionInUrl:false,flowType:'pkce',lock:processLock}});
AppState.addEventListener('change',state=>{if(state==='active')supabase.auth.startAutoRefresh();else supabase.auth.stopAutoRefresh()});
