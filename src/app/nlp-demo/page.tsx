'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const SAMPLE_TEXTS = [
  {
    label: "Intimate/Personal",
    text: "Hey honey! Just wanted to let you know I'll be home late tonight. Love you! 💕"
  },
  {
    label: "Very Familiar",
    text: "Dude! That was insane lol. We gotta do that again soon haha! Hit me up!"
  },
  {
    label: "Professional",
    text: "Hi Joe, per our discussion, I've attached the quarterly report for your review. Please let me know if you need any clarification."
  },
  {
    label: "Formal",
    text: "Dear Dr. Johnson, I hope this email finds you well. Pursuant to our conversation last week, I am writing to request an appointment."
  },
  {
    label: "Urgent",
    text: "URGENT: Need the presentation slides ASAP! The client meeting is in 30 minutes!!!"
  }
];

interface NLPAnalysis {
  sentiment: {
    primary: string;
    score: number;
    confidence: number;
    emotions: string[];
  };
  relationship: {
    familiarity: string;
    markers: {
      greeting: string;
      closing: string;
      informal: number;
      professional: number;
      endearments: number;
    };
  };
  tone: {
    warmth: number;
    formality: number;
    politeness: number;
    urgency: number;
    directness: number;
    enthusiasm: number;
  };
  style: {
    vocabularyComplexity: string;
    sentenceStructure: string;
  };
  context: string;
  stats: {
    wordCount: number;
    sentenceCount: number;
    avgWordsPerSentence: number;
    formalityScore: number;
  };
}

export default function NLPDemoPage() {
  const [text, setText] = useState('');
  const [analysis, setAnalysis] = useState<NLPAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  const analyzeText = async () => {
    if (!text.trim()) return;
    
    setLoading(true);
    try {
      const response = await fetch('http://localhost:3002/api/nlp/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      
      const data = await response.json();
      if (data.success) {
        setAnalysis(data.analysis);
      }
    } catch (error) {
      console.error('Analysis failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSample = (sampleText: string) => {
    setText(sampleText);
    setAnalysis(null);
  };

  const ToneBar = ({ label, value }: { label: string; value: number }) => (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-24">{label}:</span>
      <div className="flex-1 bg-gray-200 rounded-full h-2">
        <div 
          className="bg-indigo-600 h-2 rounded-full transition-all"
          style={{ width: `${value * 100}%` }}
        />
      </div>
      <span className="w-12 text-right">{Math.round(value * 100)}%</span>
    </div>
  );

  return (
    <div className="container mx-auto p-4 max-w-6xl">
      <h1 className="text-3xl font-bold mb-6">NLP Feature Extractor Demo</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input Section */}
        <Card>
          <CardHeader>
            <CardTitle>Email Text Input</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder="Enter email text to analyze..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-[200px]"
            />
            
            <div className="flex gap-2">
              <Button 
                onClick={analyzeText} 
                disabled={loading || !text.trim()}
              >
                {loading ? 'Analyzing...' : 'Analyze'}
              </Button>
              <Button 
                variant="outline" 
                onClick={() => { setText(''); setAnalysis(null); }}
              >
                Clear
              </Button>
            </div>
            
            <div className="space-y-2">
              <p className="text-sm font-medium">Sample Texts:</p>
              <div className="flex flex-wrap gap-2">
                {SAMPLE_TEXTS.map((sample, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    onClick={() => loadSample(sample.text)}
                  >
                    {sample.label}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results Section */}
        <Card>
          <CardHeader>
            <CardTitle>Analysis Results</CardTitle>
          </CardHeader>
          <CardContent>
            {!analysis ? (
              <p className="text-gray-500">Enter text and click Analyze to see results</p>
            ) : (
              <Tabs defaultValue="sentiment" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="sentiment">Sentiment</TabsTrigger>
                  <TabsTrigger value="relationship">Relationship</TabsTrigger>
                  <TabsTrigger value="tone">Tone</TabsTrigger>
                  <TabsTrigger value="style">Style</TabsTrigger>
                </TabsList>
                
                <TabsContent value="sentiment" className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Primary:</span>
                      <Badge variant={
                        analysis.sentiment.primary === 'positive' ? 'default' :
                        analysis.sentiment.primary === 'negative' ? 'destructive' :
                        'secondary'
                      }>
                        {analysis.sentiment.primary}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Score:</span>
                      <span>{analysis.sentiment.score.toFixed(3)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Confidence:</span>
                      <span>{Math.round(analysis.sentiment.confidence * 100)}%</span>
                    </div>
                    {analysis.sentiment.emotions.length > 0 && (
                      <div>
                        <span>Emotions:</span>
                        <div className="flex gap-1 mt-1">
                          {analysis.sentiment.emotions.map((emotion: string) => (
                            <Badge key={emotion} variant="outline" className="text-xs">
                              {emotion}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>
                
                <TabsContent value="relationship" className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Familiarity:</span>
                      <Badge>{analysis.relationship.familiarity}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Greeting:</span>
                      <span className="text-sm">{analysis.relationship.markers.greeting}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Closing:</span>
                      <span className="text-sm">{analysis.relationship.markers.closing}</span>
                    </div>
                    <div className="text-sm space-y-1 mt-3">
                      <div>Informal markers: {analysis.relationship.markers.informal}</div>
                      <div>Professional phrases: {analysis.relationship.markers.professional}</div>
                      <div>Endearments: {analysis.relationship.markers.endearments}</div>
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="tone" className="space-y-3">
                  <ToneBar label="Warmth" value={analysis.tone.warmth} />
                  <ToneBar label="Formality" value={analysis.tone.formality} />
                  <ToneBar label="Politeness" value={analysis.tone.politeness} />
                  <ToneBar label="Urgency" value={analysis.tone.urgency} />
                  <ToneBar label="Directness" value={analysis.tone.directness} />
                  <ToneBar label="Enthusiasm" value={analysis.tone.enthusiasm} />
                </TabsContent>
                
                <TabsContent value="style" className="space-y-3">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Vocabulary:</span>
                      <Badge variant="outline">{analysis.style.vocabularyComplexity}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Sentences:</span>
                      <Badge variant="outline">{analysis.style.sentenceStructure}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span>Context:</span>
                      <Badge variant="outline">{analysis.context}</Badge>
                    </div>
                    <div className="pt-3 space-y-1 text-sm">
                      <div>Words: {analysis.stats.wordCount}</div>
                      <div>Sentences: {analysis.stats.sentenceCount}</div>
                      <div>Avg words/sentence: {analysis.stats.avgWordsPerSentence.toFixed(1)}</div>
                      <div>Formality score: {Math.round(analysis.stats.formalityScore * 100)}%</div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>
      
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>About This Demo</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600">
            This demo showcases the enhanced NLP capabilities including:
          </p>
          <ul className="list-disc list-inside text-sm text-gray-600 mt-2 space-y-1">
            <li>Sentiment analysis using wink-sentiment for word-level analysis</li>
            <li>Relationship detection using Compromise.js linguistic tags</li>
            <li>Emotion extraction based on sentiment scores</li>
            <li>Comprehensive tone and formality analysis</li>
            <li>Linguistic style detection (vocabulary, sentence structure)</li>
            <li>No more hard-coded word lists - using NLP libraries properly!</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}