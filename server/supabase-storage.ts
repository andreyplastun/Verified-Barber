import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const hasCredentials = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);

if (!hasCredentials) {
  console.warn('[SUPABASE STORAGE] Missing credentials - photo upload disabled');
}

// Only create client if we have valid credentials
let supabaseAdmin: SupabaseClient | null = null;

if (hasCredentials) {
  supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export { supabaseAdmin };

export const BUCKET_NAME = 'specialist-photos';

export function isStorageEnabled(): boolean {
  return hasCredentials && supabaseAdmin !== null;
}

export async function ensureBucketExists(): Promise<boolean> {
  if (!supabaseAdmin) {
    console.warn('[SUPABASE STORAGE] Storage not configured');
    return false;
  }
  
  try {
    const { data: buckets } = await supabaseAdmin.storage.listBuckets();
    const exists = buckets?.some(b => b.name === BUCKET_NAME);
    
    if (!exists) {
      const { error } = await supabaseAdmin.storage.createBucket(BUCKET_NAME, {
        public: true,
        fileSizeLimit: 5 * 1024 * 1024, // 5MB
        allowedMimeTypes: ['image/jpeg', 'image/png']
      });
      
      if (error) {
        console.error('[SUPABASE STORAGE] Error creating bucket:', error.message);
        return false;
      }
      console.log('[SUPABASE STORAGE] Bucket created:', BUCKET_NAME);
    }
    
    return true;
  } catch (err: any) {
    console.error('[SUPABASE STORAGE] Error ensuring bucket:', err.message);
    return false;
  }
}

export async function uploadPhoto(
  file: Buffer,
  fileName: string,
  contentType: string
): Promise<{ url: string; path: string } | null> {
  if (!supabaseAdmin) {
    console.error('[SUPABASE STORAGE] Storage not configured - cannot upload');
    return null;
  }
  
  const path = `photos/${Date.now()}_${fileName}`;
  
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .upload(path, file, {
      contentType,
      upsert: false
    });

  if (error) {
    console.error('[SUPABASE STORAGE] Upload error:', error.message);
    return null;
  }

  const { data: urlData } = supabaseAdmin.storage
    .from(BUCKET_NAME)
    .getPublicUrl(path);

  return {
    url: urlData.publicUrl,
    path: path
  };
}

export async function deletePhoto(path: string): Promise<boolean> {
  if (!supabaseAdmin) {
    console.error('[SUPABASE STORAGE] Storage not configured - cannot delete');
    return false;
  }
  
  const { error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .remove([path]);

  if (error) {
    console.error('[SUPABASE STORAGE] Delete error:', error.message);
    return false;
  }

  return true;
}
