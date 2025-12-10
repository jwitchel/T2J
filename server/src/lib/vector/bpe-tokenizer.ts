/**
 * BPE (Byte-Pair Encoding) Tokenizer for RoBERTa
 *
 * Implements proper BPE tokenization for the AnnaWegmann/Style-Embedding model
 * which is based on RoBERTa and uses GPT-2 style BPE encoding
 */

import fs from 'fs';

export class BPETokenizer {
  private vocab: Map<string, number> = new Map();
  private merges: Map<string, number> = new Map();
  private cache: Map<string, string[]> = new Map();

  // Special tokens for RoBERTa
  private readonly BOS_TOKEN = '<s>';
  private readonly EOS_TOKEN = '</s>';
  private readonly PAD_TOKEN = '<pad>';
  private readonly UNK_TOKEN = '<unk>';

  constructor(vocabPath: string, mergesPath: string) {
    this._loadVocab(vocabPath);
    this._loadMerges(mergesPath);
  }

  private _loadVocab(vocabPath: string): void {
    const vocabData = JSON.parse(fs.readFileSync(vocabPath, 'utf-8'));
    this.vocab = new Map(Object.entries(vocabData));
  }

  private _loadMerges(mergesPath: string): void {
    const mergesText = fs.readFileSync(mergesPath, 'utf-8');
    const lines = mergesText.split('\n');

    // Skip the version line and process merge rules
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line) {
        this.merges.set(line, i - 1);
      }
    }
  }

  /**
   * Get all bigram pairs in a word
   */
  private _getPairs(word: string[]): Set<string> {
    const pairs = new Set<string>();
    for (let i = 0; i < word.length - 1; i++) {
      pairs.add(word[i] + ' ' + word[i + 1]);
    }
    return pairs;
  }

  /**
   * Apply BPE merges to a word
   */
  private _bpe(token: string): string[] {
    // Check cache
    if (this.cache.has(token)) {
      return this.cache.get(token)!;
    }

    let word = token.split('');
    let pairs = this._getPairs(word);

    if (pairs.size === 0) {
      return [token];
    }

    while (true) {
      // Find the pair with lowest merge index (highest priority)
      let minPair: string | null = null;
      let minRank = Infinity;

      for (const pair of pairs) {
        const rank = this.merges.get(pair);
        if (rank !== undefined && rank < minRank) {
          minRank = rank;
          minPair = pair;
        }
      }

      if (minPair === null) {
        break;
      }

      const parts = minPair.split(' ');
      const first = parts[0];
      const second = parts[1];
      const newWord: string[] = [];
      let i = 0;

      while (i < word.length) {
        const j = word.indexOf(first, i);
        if (j === -1) {
          newWord.push(...word.slice(i));
          break;
        }

        newWord.push(...word.slice(i, j));
        i = j;

        if (word[i] === first && i < word.length - 1 && word[i + 1] === second) {
          newWord.push(first + second);
          i += 2;
        } else {
          newWord.push(word[i]);
          i += 1;
        }
      }

      word = newWord;
      if (word.length === 1) {
        break;
      }
      pairs = this._getPairs(word);
    }

    // Cache result
    this.cache.set(token, word);
    return word;
  }

  /**
   * Tokenize text and return token IDs
   */
  encode(text: string, maxLength: number = 128): { inputIds: number[]; attentionMask: number[] } {
    const tokens: number[] = [];

    // Add BOS token
    tokens.push(this.vocab.get(this.BOS_TOKEN) || 0);

    // Split on whitespace and process each word
    const words = text.trim().split(/\s+/);

    for (let i = 0; i < words.length; i++) {
      // Add space prefix (Ġ) except for first word
      const prefix = i === 0 ? '' : 'Ġ';
      const word = prefix + words[i];

      // Apply BPE
      const bpeTokens = this._bpe(word);

      // Convert to IDs
      for (const token of bpeTokens) {
        const id = this.vocab.get(token) ?? this.vocab.get(this.UNK_TOKEN) ?? 3;
        tokens.push(id as number);

        // Stop if we reach max length - 1 (need to save space for EOS)
        if (tokens.length >= maxLength - 1) {
          break;
        }
      }

      if (tokens.length >= maxLength - 1) {
        break;
      }
    }

    // Add EOS token
    tokens.push(this.vocab.get(this.EOS_TOKEN) || 2);

    // Create attention mask (1 for real tokens)
    const attentionMask = new Array(tokens.length).fill(1);

    // Pad to maxLength
    const padId = this.vocab.get(this.PAD_TOKEN) || 1;
    while (tokens.length < maxLength) {
      tokens.push(padId as number);
      attentionMask.push(0);
    }

    return { inputIds: tokens, attentionMask };
  }

  /**
   * Decode token IDs back to text
   */
  decode(tokenIds: number[]): string {
    const reverseVocab = new Map(
      Array.from(this.vocab.entries()).map(([k, v]) => [v, k])
    );

    const tokens = tokenIds
      .filter(id => {
        const token = reverseVocab.get(id);
        return token && token !== this.BOS_TOKEN && token !== this.EOS_TOKEN && token !== this.PAD_TOKEN;
      })
      .map(id => reverseVocab.get(id) || this.UNK_TOKEN);

    // Join and replace Ġ with spaces
    return tokens.join('').replace(/Ġ/g, ' ').trim();
  }

  getVocabSize(): number {
    return this.vocab.size;
  }
}
