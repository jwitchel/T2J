import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const ITERATIONS = 100000;
const KEY_LENGTH = 32;

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

export function encryptPassword(password: string): string {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }

  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(encryptionKey, salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(password, 'utf8'),
    cipher.final()
  ]);
  
  const authTag = cipher.getAuthTag();
  
  // Format: salt:iv:authTag:encrypted (all in base64)
  return [
    salt.toString('base64'),
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64')
  ].join(':');
}

export function decryptPassword(encryptedData: string): string {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }

  const parts = encryptedData.split(':');
  
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted data format');
  }
  
  const [saltBase64, ivBase64, authTagBase64, encryptedBase64] = parts;
  
  try {
    const salt = Buffer.from(saltBase64, 'base64');
    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const encrypted = Buffer.from(encryptedBase64, 'base64');
    
    const key = deriveKey(encryptionKey, salt);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    return decrypted.toString('utf8');
  } catch (error: unknown) {
    throw new Error('Failed to decrypt password');
  }
}

// Generic encrypt function (alias for encryptPassword)
export const encrypt = encryptPassword;

// Generic decrypt function (alias for decryptPassword)
export const decrypt = decryptPassword;