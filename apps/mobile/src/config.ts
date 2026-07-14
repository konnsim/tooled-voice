const trailingSlashPattern = /\/$/;
const required = (
  name:
    | 'EXPO_PUBLIC_SUPABASE_URL'
    | 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
    | 'EXPO_PUBLIC_API_URL'
) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return name === 'EXPO_PUBLIC_API_URL'
    ? value.replace(trailingSlashPattern, '')
    : value;
};
export const config = {
  apiUrl: required('EXPO_PUBLIC_API_URL'),
  supabaseKey: required('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  supabaseUrl: required('EXPO_PUBLIC_SUPABASE_URL'),
};
