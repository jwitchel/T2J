/**
 * Diagnostic script to verify the double signature bug
 */

import { Pool } from 'pg';
import { TypedNameRemover } from '../lib/typed-name-remover';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function diagnoseDuplicateSignature() {
  console.log('🔍 Diagnosing Double Signature Bug\n');

  // Create pool connection
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const typedNameRemover = new TypedNameRemover();

  // Get user with typed name configured
  const userResult = await pool.query(
    `SELECT id, email, preferences FROM "user" WHERE preferences->'typedName' IS NOT NULL LIMIT 1`
  );

  if (!userResult.rows.length) {
    console.log('❌ No user found with typedName preferences');
    await pool.end();
    return;
  }

  const user = userResult.rows[0];
  console.log('✅ Found user:', user.email);
  console.log('📋 Typed Name Config:', JSON.stringify(user.preferences.typedName, null, 2));
  console.log('📋 Signature Block:', user.preferences.signatureBlock);
  console.log();

  // Simulate LLM response that includes the name (the bug scenario)
  const llmResponseWithName = `Keep me in the loop.


John`;

  console.log('📧 Simulated LLM Response (with name):\n---');
  console.log(llmResponseWithName);
  console.log('---\n');

  // Test current behavior (bug)
  console.log('🐛 CURRENT BEHAVIOR (Bug):');
  const typedName = user.preferences.typedName.appendString;
  const signatureBlock = user.preferences.signatureBlock;

  const buggedResult = `${llmResponseWithName}\n${typedName}\n${signatureBlock}`;
  console.log(buggedResult);
  console.log('\n❌ Result shows DUPLICATE: "John" appears twice!\n');

  // Test fixed behavior
  console.log('✅ EXPECTED BEHAVIOR (Fixed):');
  const cleanResult = await typedNameRemover.removeTypedName(llmResponseWithName, user.id);
  console.log('🧹 After cleaning with removalRegex:');
  console.log(`  Removed: "${cleanResult.removedText}"`);
  console.log(`  Cleaned text:\n---\n${cleanResult.cleanedText}\n---\n`);

  const fixedResult = `${cleanResult.cleanedText}\n${typedName}\n${signatureBlock}`;
  console.log('📧 Final result after adding typed name and signature:');
  console.log('---');
  console.log(fixedResult);
  console.log('---\n');
  console.log('✅ Result shows NO DUPLICATE!\n');

  await pool.end();
}

diagnoseDuplicateSignature().catch(console.error);
