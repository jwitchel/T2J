import { pool } from '../lib/db';
import { styleEmbeddingService } from '../lib/vector/style-embedding-service';
import { embeddingService } from '../lib/vector/embedding-service';

async function testStyleAnalysis() {
  try {
    console.log('Testing AnnaWegmann/Style-Embedding Model\n');

    await styleEmbeddingService.initialize();
    await embeddingService.initialize();

    console.log('Model Information:');
    console.log('  Style Model:', styleEmbeddingService.getModelInfo());
    console.log('  Semantic Model:', embeddingService.getModelInfo());
    console.log('');

    console.log('TEST 1: Different content, similar casual style');
    console.log('='.repeat(60));
    
    const casual1 = "Hey! Just wanted to check in. Let me know if you need anything.";
    const casual2 = "Thanks! That sounds good. I'll get back to you soon.";
    const formal = "Dear Sir/Madam, I am writing to inquire about the status of our previous correspondence.";

    const casual1Style = await styleEmbeddingService.embedText(casual1);
    const casual2Style = await styleEmbeddingService.embedText(casual2);
    const formalStyle = await styleEmbeddingService.embedText(formal);

    const casual1Semantic = await embeddingService.embedText(casual1);
    const casual2Semantic = await embeddingService.embedText(casual2);
    const formalSemantic = await embeddingService.embedText(formal);

    const styleSimilarityCasual = styleEmbeddingService.cosineSimilarity(casual1Style.vector, casual2Style.vector);
    const styleSimilarityFormal = styleEmbeddingService.cosineSimilarity(casual1Style.vector, formalStyle.vector);
    const semanticSimilarityCasual = embeddingService.cosineSimilarity(casual1Semantic.vector, casual2Semantic.vector);
    const semanticSimilarityFormal = embeddingService.cosineSimilarity(casual1Semantic.vector, formalSemantic.vector);

    console.log('Text 1 (casual):', casual1);
    console.log('Text 2 (casual):', casual2);
    console.log('Text 3 (formal):', formal);
    console.log('');
    console.log('Style Similarity:');
    console.log('  Casual 1 to Casual 2:', (styleSimilarityCasual * 100).toFixed(1) + '%');
    console.log('  Casual 1 to Formal:  ', (styleSimilarityFormal * 100).toFixed(1) + '%');
    console.log('');
    console.log('Semantic Similarity:');
    console.log('  Casual 1 to Casual 2:', (semanticSimilarityCasual * 100).toFixed(1) + '%');
    console.log('  Casual 1 to Formal:  ', (semanticSimilarityFormal * 100).toFixed(1) + '%');
    console.log('');

    const styleGap = styleSimilarityCasual - styleSimilarityFormal;
    console.log('Style model discriminates:', styleGap > 0.1 ? 'YES' : 'NO');
    console.log('  Gap:', (styleGap * 100).toFixed(1) + '%');
    console.log('');

    console.log('TEST 2: Database style vectors');
    console.log('='.repeat(60));

    const vectorCheck = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(style_vector) as with_style
      FROM email_sent
      WHERE user_id = (SELECT id FROM "user" WHERE email = 'user1@testmail.local')
    `);

    const dimCheck = await pool.query(`
      SELECT array_length(style_vector, 1) as style_dim
      FROM email_sent
      WHERE user_id = (SELECT id FROM "user" WHERE email = 'user1@testmail.local')
        AND style_vector IS NOT NULL
      LIMIT 1
    `);

    const stats = vectorCheck.rows[0];
    const dim = dimCheck.rows[0];
    console.log('Total emails:', stats.total);
    console.log('With style vectors:', stats.with_style);
    console.log('Style vector dimensions:', dim.style_dim + 'd');
    console.log('All vectors present:', parseInt(stats.total) === parseInt(stats.with_style) ? 'YES' : 'NO');
    console.log('');

    console.log('All tests completed successfully!');

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testStyleAnalysis();
