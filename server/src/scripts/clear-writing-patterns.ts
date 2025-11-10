import { pool } from '../lib/db';
import dotenv from 'dotenv';
import path from 'path';
import chalk from 'chalk';

// Set environment variable to prevent server start
process.env.SKIP_SERVER_START = 'true';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../../.env') });

async function clearWritingPatterns() {
  console.log(chalk.bold('Clearing Writing Patterns from Database...\n'));
  
  try {
    // Clear patterns from relationship_tone_preferences
    console.log(chalk.blue('1. Clearing relationship-specific patterns...'));
    const relationshipResult = await pool.query(`
      UPDATE relationship_tone_preferences 
      SET style_preferences = jsonb_set(
        COALESCE(style_preferences, '{}'::jsonb),
        '{writingPatterns}',
        'null'
      )
      WHERE style_preferences->>'writingPatterns' IS NOT NULL
    `);
    console.log(chalk.gray(`  Cleared ${relationshipResult.rowCount} relationship patterns`));
    
    // Clear patterns from tone_profiles
    console.log(chalk.blue('\n2. Clearing user-level patterns...'));
    const profileResult = await pool.query(`
      UPDATE tone_profiles 
      SET profile_data = jsonb_set(
        COALESCE(profile_data, '{}'::jsonb),
        '{writingPatterns}',
        'null'
      )
      WHERE profile_data->>'writingPatterns' IS NOT NULL
    `);
    console.log(chalk.gray(`  Cleared ${profileResult.rowCount} user patterns`));
    
    console.log(chalk.green('\n✓ All writing patterns cleared successfully!'));
    console.log(chalk.gray('\nNext time you use the Training panel, it will:'));
    console.log(chalk.gray('  1. Fetch up to 200 emails for the relationship'));
    console.log(chalk.gray('  2. Analyze them to extract new patterns'));
    console.log(chalk.gray('  3. Save the patterns for future use'));
    
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  } finally {
    await pool.end();
  }
}

// Run the script
clearWritingPatterns().catch(console.error);