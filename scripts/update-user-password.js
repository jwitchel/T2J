const { Pool } = require('pg');
const { scryptAsync } = require('@noble/hashes/scrypt');
const { bytesToHex } = require('@noble/hashes/utils');
require('dotenv').config();

// Scrypt configuration matching better-auth
const scryptConfig = {
  N: 16384,
  r: 16,
  p: 1,
  dkLen: 64
};

async function hashPassword(password) {
  // Generate random salt (16 bytes)
  const crypto = require('crypto');
  const saltBuffer = crypto.randomBytes(16);
  const salt = bytesToHex(saltBuffer);
  
  // Generate key using scrypt from @noble/hashes (same as better-auth)
  const key = await scryptAsync(
    password.normalize('NFKC'),
    salt,
    {
      N: scryptConfig.N,
      r: scryptConfig.r,
      p: scryptConfig.p,
      dkLen: scryptConfig.dkLen,
      maxmem: 128 * scryptConfig.N * scryptConfig.r * 2
    }
  );
  
  // Return in better-auth format: salt:key (both hex encoded)
  return `${salt}:${bytesToHex(key)}`;
}

async function updateUserPassword(email, newPassword) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log(`🔄 Updating password for ${email}...`);

    // Hash the new password
    const hashedPassword = await hashPassword(newPassword);

    // Update the password in the account table
    const result = await pool.query(
      `UPDATE account 
       SET password = $1, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "userId" = (SELECT id FROM "user" WHERE email = $2)
       RETURNING "userId"`,
      [hashedPassword, email]
    );

    if (result.rowCount > 0) {
      console.log(`✅ Password updated successfully for ${email}`);
      console.log(`📧 Email: ${email}`);
      console.log(`🔑 New Password: ${newPassword}`);
    } else {
      console.log(`❌ No account found for ${email}`);
    }

  } catch (error) {
    console.error('❌ Error updating password:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Update jane@test.com password to 12345678
updateUserPassword('jane@test.com', '12345678');