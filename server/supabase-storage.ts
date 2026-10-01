import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { PHOTO_BUCKET_NAME, storePhoto, removePhoto, type PhotoDerivative, type PhotoUploadResult } from './photo-storage';
import { uploadSpecialistPhoto } from './photo-upload';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

console.log(`[SUPABASE STORAGE] URL present: ${!!SUPABASE_URL}, KEY present: ${!!SUPABASE_SERVICE_KEY}`);

const hasCredentials = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);

if (!hasCredentials) {
  console.warn('[SUPABASE STORAGE] Missing credentials - photo upload disabled');
  console.warn(`[SUPABASE STORAGE] URL length: ${SUPABASE_URL.length}, KEY length: ${SUPABASE_SERVICE_KEY.length}`);
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

export const BUCKET_NAME = PHOTO_BUCKET_NAME;

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
  contentType: string,
  options?: PhotoDerivative | { preview?: boolean }
): Promise<PhotoUploadResult | null> {
  if (!supabaseAdmin) {
    console.error('[SUPABASE STORAGE] Storage not configured - cannot upload');
    return null;
  }
  
  // Keep validation/busy errors typed for the upload route's 400/429 responses.
  if (options && "preview" in options && options.preview) {
    return uploadSpecialistPhoto(supabaseAdmin.storage.from(BUCKET_NAME), file, contentType);
  }

  try {
    const derivative = options && "file" in options ? options : undefined;
    const result = await storePhoto(supabaseAdmin.storage.from(BUCKET_NAME), file, fileName, contentType, derivative);
    if (result.warning) console.warn('[SUPABASE STORAGE]', result.warning);
    return result;
  } catch (error) {
    console.error('[SUPABASE STORAGE] Upload error:', error instanceof Error ? error.message : error);
    return null;
  }
}

export async function deletePhoto(path: string): Promise<boolean> {
  if (!supabaseAdmin) {
    console.error('[SUPABASE STORAGE] Storage not configured - cannot delete');
    return false;
  }
  
  try {
    await removePhoto(supabaseAdmin.storage.from(BUCKET_NAME), path);
    return true;
  } catch (error) {
    console.error('[SUPABASE STORAGE] Delete error:', error instanceof Error ? error.message : error);
    return false;
  }
}
