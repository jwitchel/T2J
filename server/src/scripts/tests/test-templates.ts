#!/usr/bin/env node
import { PromptFormatterV2 } from '../../lib/pipeline/prompt-formatter-v2';
import { SelectedExample } from '../../lib/pipeline/example-selector';
import { RelationshipProfile } from '../../lib/pipeline/types';

// Create sample examples
const createSampleExamples = (): SelectedExample[] => [
  {
    id: 'ex1',
    text: "Hey Sarah! I'll be home around 7pm tonight. Want me to pick up dinner on the way? Love you!",
    metadata: {
      relationship: { type: 'spouse', confidence: 0.95, detectionMethod: 'manual' },
      features: {
        stats: { formalityScore: 0.1, wordCount: 18 },
        sentiment: { dominant: 'positive' },
        urgency: { level: 'low' }
      },
      wordCount: 18,
      subject: 'Re: Dinner plans'
    },
    scores: {
      semantic: 0.92,
      style: 0.97,
      combined: 0.95
    }
  },
  {
    id: 'ex2',
    text: "Running late from the meeting, traffic is crazy. Be there in 30-40 mins. Sorry babe!",
    metadata: {
      relationship: { type: 'spouse', confidence: 0.9, detectionMethod: 'auto' },
      features: {
        stats: { formalityScore: 0.15, wordCount: 15 },
        sentiment: { dominant: 'neutral' },
        urgency: { level: 'high' }
      },
      wordCount: 15,
      subject: 'Re: Movie night'
    },
    scores: {
      semantic: 0.85,
      style: 0.90,
      combined: 0.88
    }
  },
  {
    id: 'ex3',
    text: "Hi John, I've reviewed the Q3 proposal and have some feedback. The revenue projections look solid, but I think we need to revisit the timeline. Can we schedule a meeting this week to discuss?",
    metadata: {
      relationship: { type: 'colleagues', confidence: 0.85, detectionMethod: 'auto' },
      features: {
        stats: { formalityScore: 0.7, wordCount: 34 },
        sentiment: { dominant: 'neutral' },
        urgency: { level: 'medium' }
      },
      wordCount: 34,
      subject: 'Re: Q3 Proposal Review'
    },
    scores: {
      semantic: 0.72,
      style: 0.78,
      combined: 0.75
    }
  }
];

const spouseProfile: RelationshipProfile = {
  typicalFormality: 'very casual',
  commonGreetings: ['Hey honey', 'Hi babe', 'Hey'],
  commonClosings: ['Love you', 'xoxo', 'Love'],
  useEmojis: true,
  useHumor: true
};

async function testTemplates() {
  console.log('🎨 Testing Handlebars Template System\n');
  
  const formatter = new PromptFormatterV2();
  await formatter.initialize();
  
  const examples = createSampleExamples();
  
  // Test 1: Default template
  console.log('1️⃣ Testing DEFAULT template...\n');
  
  const defaultPrompt = await formatter.formatWithExamples({
    incomingEmail: "When will you be home tonight?",
    recipientEmail: "sarah@gmail.com",
    relationship: "spouse",
    examples,
    relationshipProfile: spouseProfile
  });
  
  console.log('Default Template Output:');
  console.log('─'.repeat(80));
  console.log(defaultPrompt);
  console.log('─'.repeat(80));
  console.log('');
  
  // Test 2: Verbose template
  console.log('2️⃣ Testing VERBOSE template...\n');
  
  const verbosePrompt = await formatter.formatVerbosePrompt({
    incomingEmail: "Can we discuss the project timeline?",
    recipientEmail: "john@company.com",
    relationship: "colleagues",
    examples,
    relationshipProfile: null
  });
  
  console.log('Verbose Template Output (first 800 chars):');
  console.log('─'.repeat(80));
  console.log(verbosePrompt.substring(0, 800) + '...');
  console.log('─'.repeat(80));
  console.log('');
  
  // Test 3: System prompt
  console.log('3️⃣ Testing SYSTEM template...\n');
  
  const systemPrompt = await formatter.formatSystemPrompt();
  
  console.log('System Template Output:');
  console.log('─'.repeat(80));
  console.log(systemPrompt);
  console.log('─'.repeat(80));
  console.log('');
  
  // Test 4: Structured output with metadata
  console.log('4️⃣ Testing structured output...\n');
  
  const structured = await formatter.formatWithExamplesStructured({
    incomingEmail: "Are you free for lunch tomorrow?",
    recipientEmail: "mike@gmail.com",
    relationship: "friends",
    examples: examples.slice(0, 2),
    relationshipProfile: null
  });
  
  console.log('Metadata:', JSON.stringify(structured.metadata, null, 2));
  console.log('');
  
  // Test 5: Template with no examples
  console.log('5️⃣ Testing with no examples...\n');
  
  const noExamplesPrompt = await formatter.formatWithExamples({
    incomingEmail: "Hello, can you help me?",
    recipientEmail: "support@company.com",
    relationship: "support",
    examples: [],
    relationshipProfile: null
  });
  
  console.log('No Examples Output:');
  console.log('─'.repeat(80));
  console.log(noExamplesPrompt);
  console.log('─'.repeat(80));
  console.log('');
  
  // Test 6: Hot reload demonstration
  console.log('6️⃣ Testing hot reload capability...\n');
  console.log('Templates are automatically reloaded when files change.');
  console.log('Try editing templates/prompts/default.hbs and run this test again!');
  
  console.log('\n✅ Template system test completed!');
  console.log('\n📁 Template files location:');
  console.log('   - Prompts: server/src/lib/pipeline/templates/prompts/');
  console.log('   - System: server/src/lib/pipeline/templates/system/');
  console.log('   - Partials: server/src/lib/pipeline/templates/partials/');
}

// Run the test
if (require.main === module) {
  testTemplates().catch(console.error);
}

export { testTemplates };