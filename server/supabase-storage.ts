import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn('[SUPABASE STORAGE] Missing credentials - photo upload disabled');
}

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

export const BUCKET_NAME = 'specialist-photos';

export async function ensureBucketExists(): Promise<boolean> {
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
  const { error } = await supabaseAdmin.storage
    .from(BUCKET_NAME)
    .remove([path]);

  if (error) {
    console.error('[SUPABASE STORAGE] Delete error:', error.message);
    return false;
  }

  return true;
}
