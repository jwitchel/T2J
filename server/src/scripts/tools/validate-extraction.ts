import { testEmailGenerator, TestEmail } from '../../lib/test-sent-emails';
import { replyExtractor } from '../../lib/reply-extractor';
import chalk from 'chalk';

interface ValidationResult {
  testId: string;
  testName: string;
  category: string;
  passed: boolean;
  expected: string;
  actual: string;
  matchPercentage: number;
  error?: string;
}

export class ExtractionValidator {
  /**
   * Validate extraction accuracy for all test emails
   */
  async validateAllTestEmails(): Promise<{
    results: ValidationResult[];
    summary: {
      total: number;
      passed: number;
      failed: number;
      accuracy: number;
      byCategory: Record<string, { total: number; passed: number }>;
    };
  }> {
    const generator = testEmailGenerator;
    const testEmails = generator.generateTestEmails();
    const results: ValidationResult[] = [];

    console.log(chalk.bold.blue(`\n🧪 Validating ${testEmails.length} test emails...\n`));

    // Process each test email
    for (const testEmail of testEmails) {
      const result = await this._validateSingleEmail(testEmail);
      results.push(result);
      
      // Print progress
      if (result.passed) {
        process.stdout.write(chalk.green('✓'));
      } else {
        process.stdout.write(chalk.red('✗'));
      }
    }

    console.log('\n');

    // Calculate summary statistics
    const summary = this._calculateSummary(results);
    
    return { results, summary };
  }

  /**
   * Validate a single test email
   */
  private async _validateSingleEmail(testEmail: TestEmail): Promise<ValidationResult> {
    try {
      // Extract text using the reply extractor
      const extracted = replyExtractor.extractUserText(testEmail.textContent);
      
      // Compare with expected
      const passed = extracted === testEmail.expectedExtraction;
      const matchPercentage = this._calculateSimilarity(extracted, testEmail.expectedExtraction);

      return {
        testId: testEmail.id,
        testName: testEmail.name,
        category: testEmail.category,
        passed,
        expected: testEmail.expectedExtraction,
        actual: extracted,
        matchPercentage
      };
    } catch (error) {
      return {
        testId: testEmail.id,
        testName: testEmail.name,
        category: testEmail.category,
        passed: false,
        expected: testEmail.expectedExtraction,
        actual: '',
        matchPercentage: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Calculate similarity percentage between two strings
   */
  private _calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 100;
    if (!str1 || !str2) return 0;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 100;

    const editDistance = this._levenshteinDistance(longer, shorter);
    return ((longer.length - editDistance) / longer.length) * 100;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private _levenshteinDistance(str1: string, str2: string): number {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Calculate summary statistics
   */
  private _calculateSummary(results: ValidationResult[]) {
    const total = results.length;
    const passed = results.filter(r => r.passed).length;
    const failed = total - passed;
    const accuracy = (passed / total) * 100;

    // Group by category
    const byCategory: Record<string, { total: number; passed: number }> = {};
    for (const result of results) {
      if (!byCategory[result.category]) {
        byCategory[result.category] = { total: 0, passed: 0 };
      }
      byCategory[result.category].total++;
      if (result.passed) {
        byCategory[result.category].passed++;
      }
    }

    return { total, passed, failed, accuracy, byCategory };
  }

  /**
   * Print detailed validation report
   */
  printReport(results: ValidationResult[], summary: any) {
    console.log(chalk.bold.cyan('\n📊 Validation Report\n'));
    console.log('='.repeat(80));

    // Summary
    console.log(chalk.bold('\nSummary:'));
    console.log(`Total Tests: ${summary.total}`);
    console.log(`Passed: ${chalk.green(summary.passed)}`);
    console.log(`Failed: ${chalk.red(summary.failed)}`);
    console.log(`Overall Accuracy: ${chalk.bold(summary.accuracy.toFixed(2) + '%')}`);

    // By category
    console.log(chalk.bold('\nResults by Category:'));
    for (const [category, stats] of Object.entries(summary.byCategory)) {
      const categoryStats = stats as { total: number; passed: number };
      const categoryAccuracy = (categoryStats.passed / categoryStats.total) * 100;
      console.log(`  ${category}: ${categoryStats.passed}/${categoryStats.total} (${categoryAccuracy.toFixed(0)}%)`);
    }

    // Failed tests details
    const failedTests = results.filter(r => !r.passed);
    if (failedTests.length > 0) {
      console.log(chalk.bold.red('\nFailed Tests:'));
      console.log('='.repeat(80));
      
      for (const test of failedTests) {
        console.log(chalk.red(`\n❌ ${test.testName} (${test.testId})`));
        console.log(`Category: ${test.category}`);
        console.log(`Match: ${test.matchPercentage.toFixed(1)}%`);
        
        if (test.error) {
          console.log(chalk.red(`Error: ${test.error}`));
        } else {
          console.log('\nExpected:');
          console.log(chalk.green(JSON.stringify(test.expected)));
          console.log('\nActual:');
          console.log(chalk.red(JSON.stringify(test.actual)));
        }
      }
    }

    // Perfect matches
    const perfectMatches = results.filter(r => r.passed && r.matchPercentage === 100);
    console.log(chalk.bold.green(`\n\n✨ Perfect Matches: ${perfectMatches.length}/${summary.total}`));
  }
}

// Main execution
if (require.main === module) {
  (async () => {
    try {
      // Install chalk if needed
      try {
        require('chalk');
      } catch {
        console.log('Installing chalk for colored output...');
        require('child_process').execSync('npm install chalk', { stdio: 'inherit' });
      }

      const validator = new ExtractionValidator();
      const { results, summary } = await validator.validateAllTestEmails();
      validator.printReport(results, summary);

      // Exit with error code if tests failed
      if (summary.failed > 0) {
        process.exit(1);
      }
    } catch (error) {
      console.error('Validation failed:', error);
      process.exit(1);
    }
  })();
}

export const extractionValidator = new ExtractionValidator();