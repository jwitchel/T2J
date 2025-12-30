import { NameExtractor } from '../name-extractor';

describe('NameExtractor', () => {
  describe('extractName', () => {
    describe('with valid recipient names', () => {
      it('should use recipient name when provided', () => {
        expect(NameExtractor.extractName('raswheeler@gmail.com', 'Jessica Wheeler'))
          .toBe('Jessica Wheeler');
      });

      it('should remove double quotes from recipient name', () => {
        expect(NameExtractor.extractName('raswheeler@gmail.com', '"Jessica Wheeler"'))
          .toBe('Jessica Wheeler');
      });

      it('should remove single quotes from recipient name', () => {
        expect(NameExtractor.extractName('test@example.com', "'John Doe'"))
          .toBe('John Doe');
      });

      it('should handle mismatched quotes', () => {
        expect(NameExtractor.extractName('test@example.com', '"John Doe\''))
          .toBe('John Doe');
        expect(NameExtractor.extractName('test@example.com', '\'Jane Smith"'))
          .toBe('Jane Smith');
      });

      it('should normalize internal whitespace', () => {
        expect(NameExtractor.extractName('test@example.com', '  John   Doe  '))
          .toBe('John Doe');
      });

      it('should preserve original casing from display names', () => {
        // Display names should keep their original casing - the sender chose it intentionally
        expect(NameExtractor.extractName('test@example.com', 'John "The Rock" Doe'))
          .toBe('John "The Rock" Doe');
        expect(NameExtractor.extractName('test@example.com', 'john "the rock" doe'))
          .toBe('john "the rock" doe');
      });

      it('should preserve brand name casing', () => {
        // Brand names like HSBCnet, AT&T, LinkedIn should not be mangled
        expect(NameExtractor.extractName('alerts@hsbc.com', 'HSBCnet Alert'))
          .toBe('HSBCnet Alert');
        expect(NameExtractor.extractName('noreply@att.com', 'AT&T Wireless'))
          .toBe('AT&T Wireless');
        expect(NameExtractor.extractName('news@linkedin.com', 'LinkedIn News'))
          .toBe('LinkedIn News');
      });

      it('should handle names with leading quote only', () => {
        expect(NameExtractor.extractName('test@example.com', '"Jessica'))
          .toBe('Jessica');
      });

      it('should handle names with trailing quote only', () => {
        expect(NameExtractor.extractName('test@example.com', 'Jessica"'))
          .toBe('Jessica');
      });

      it('should flip Last, First format to First Last', () => {
        expect(NameExtractor.extractName('test@example.com', 'Viola, John L.'))
          .toBe('John L. Viola');
      });

      it('should flip simple Last, First format', () => {
        expect(NameExtractor.extractName('test@example.com', 'Smith, Jane'))
          .toBe('Jane Smith');
      });

      it('should handle Last, First with quotes', () => {
        expect(NameExtractor.extractName('test@example.com', '"Doe, John"'))
          .toBe('John Doe');
      });

      it('should not flip names with multiple commas', () => {
        expect(NameExtractor.extractName('test@example.com', 'Company, Inc., Legal'))
          .toBe('Company, Inc., Legal');
      });

      it('should not flip names without commas', () => {
        expect(NameExtractor.extractName('test@example.com', 'John Doe'))
          .toBe('John Doe');
      });

      it('should handle Last, First with middle initial', () => {
        expect(NameExtractor.extractName('test@example.com', 'Kennedy, John F.'))
          .toBe('John F. Kennedy');
      });

      it('should handle Last, First with extra spaces', () => {
        expect(NameExtractor.extractName('test@example.com', 'Smith  ,   Jane'))
          .toBe('Jane Smith');
      });
    });

    describe('fallback to email prefix', () => {
      it('should format simple email prefix', () => {
        expect(NameExtractor.extractName('raswheeler@gmail.com', undefined))
          .toBe('Raswheeler');
      });

      it('should convert dots to spaces and capitalize', () => {
        expect(NameExtractor.extractName('john.doe@example.com', undefined))
          .toBe('John Doe');
      });

      it('should handle initials separated by dots', () => {
        expect(NameExtractor.extractName('j.w.smith@example.com', undefined))
          .toBe('J W Smith');
      });

      it('should handle multiple dots', () => {
        expect(NameExtractor.extractName('mary.jane.watson@example.com', undefined))
          .toBe('Mary Jane Watson');
      });

      it('should normalize case properly', () => {
        expect(NameExtractor.extractName('JOHN.DOE@example.com', undefined))
          .toBe('John Doe');
      });

      it('should handle single character parts', () => {
        expect(NameExtractor.extractName('a.b.c.d@example.com', undefined))
          .toBe('A B C D');
      });

      it('should use email prefix when recipient name is empty string', () => {
        expect(NameExtractor.extractName('john.doe@example.com', ''))
          .toBe('John Doe');
      });

      it('should use email prefix when recipient name is only whitespace', () => {
        expect(NameExtractor.extractName('john.doe@example.com', '   '))
          .toBe('John Doe');
      });

      it('should use email prefix when recipient name is only quotes', () => {
        expect(NameExtractor.extractName('john.doe@example.com', '""'))
          .toBe('John Doe');
      });
    });

    describe('edge cases', () => {
      it('should handle email with no dots in prefix', () => {
        expect(NameExtractor.extractName('admin@example.com', undefined))
          .toBe('Admin');
      });

      it('should handle email with numbers', () => {
        expect(NameExtractor.extractName('john.doe123@example.com', undefined))
          .toBe('John Doe123');
      });

      it('should handle email with underscores (not replaced)', () => {
        expect(NameExtractor.extractName('john_doe@example.com', undefined))
          .toBe('John_doe');
      });

      it('should handle complex email with dots and numbers', () => {
        expect(NameExtractor.extractName('j.smith2024@example.com', undefined))
          .toBe('J Smith2024');
      });
    });
  });
});
