import { NameExtractor } from '../name-extractor';

describe('NameExtractor', () => {
  describe('extractName', () => {
    describe('with valid recipient names', () => {
      it('should use recipient name when provided', () => {
        expect(NameExtractor.extractName('jsmith@gmail.com', 'Jane Smith'))
          .toBe('Jane Smith');
      });

      it('should remove double quotes from recipient name', () => {
        expect(NameExtractor.extractName('jsmith@gmail.com', '"Jane Smith"'))
          .toBe('Jane Smith');
      });

      it('should remove single quotes from recipient name', () => {
        expect(NameExtractor.extractName('test@example.com', "'Joe Doe'"))
          .toBe('Joe Doe');
      });

      it('should handle mismatched quotes', () => {
        expect(NameExtractor.extractName('test@example.com', '"Joe Doe\''))
          .toBe('Joe Doe');
        expect(NameExtractor.extractName('test@example.com', '\'Jane Smith"'))
          .toBe('Jane Smith');
      });

      it('should normalize internal whitespace', () => {
        expect(NameExtractor.extractName('test@example.com', '  Joe   Doe  '))
          .toBe('Joe Doe');
      });

      it('should capitalize all words including quoted nicknames', () => {
        expect(NameExtractor.extractName('test@example.com', 'Joe "The Rock" Doe'))
          .toBe('Joe "The Rock" Doe');
        expect(NameExtractor.extractName('test@example.com', 'joe "the rock" doe'))
          .toBe('Joe "The Rock" Doe');
      });

      it('should handle names with leading quote only', () => {
        expect(NameExtractor.extractName('test@example.com', '"Jane'))
          .toBe('Jane');
      });

      it('should handle names with trailing quote only', () => {
        expect(NameExtractor.extractName('test@example.com', 'Jane"'))
          .toBe('Jane');
      });

      it('should flip Last, First format to First Last', () => {
        expect(NameExtractor.extractName('test@example.com', 'Adams, Joe L.'))
          .toBe('Joe L. Adams');
      });

      it('should flip simple Last, First format', () => {
        expect(NameExtractor.extractName('test@example.com', 'Smith, Jane'))
          .toBe('Jane Smith');
      });

      it('should handle Last, First with quotes', () => {
        expect(NameExtractor.extractName('test@example.com', '"Doe, Joe"'))
          .toBe('Joe Doe');
      });

      it('should not flip names with multiple commas', () => {
        expect(NameExtractor.extractName('test@example.com', 'Company, Inc., Legal'))
          .toBe('Company, Inc., Legal');
      });

      it('should not flip names without commas', () => {
        expect(NameExtractor.extractName('test@example.com', 'Joe Doe'))
          .toBe('Joe Doe');
      });

      it('should handle Last, First with middle initial', () => {
        expect(NameExtractor.extractName('test@example.com', 'Adams, Joe F.'))
          .toBe('Joe F. Adams');
      });

      it('should handle Last, First with extra spaces', () => {
        expect(NameExtractor.extractName('test@example.com', 'Smith  ,   Jane'))
          .toBe('Jane Smith');
      });
    });

    describe('fallback to email prefix', () => {
      it('should format simple email prefix', () => {
        expect(NameExtractor.extractName('jsmith@gmail.com', undefined))
          .toBe('Jsmith');
      });

      it('should convert dots to spaces and capitalize', () => {
        expect(NameExtractor.extractName('joe.doe@example.com', undefined))
          .toBe('Joe Doe');
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
        expect(NameExtractor.extractName('JOE.DOE@example.com', undefined))
          .toBe('Joe Doe');
      });

      it('should handle single character parts', () => {
        expect(NameExtractor.extractName('a.b.c.d@example.com', undefined))
          .toBe('A B C D');
      });

      it('should use email prefix when recipient name is empty string', () => {
        expect(NameExtractor.extractName('joe.doe@example.com', ''))
          .toBe('Joe Doe');
      });

      it('should use email prefix when recipient name is only whitespace', () => {
        expect(NameExtractor.extractName('joe.doe@example.com', '   '))
          .toBe('Joe Doe');
      });

      it('should use email prefix when recipient name is only quotes', () => {
        expect(NameExtractor.extractName('joe.doe@example.com', '""'))
          .toBe('Joe Doe');
      });
    });

    describe('edge cases', () => {
      it('should handle email with no dots in prefix', () => {
        expect(NameExtractor.extractName('admin@example.com', undefined))
          .toBe('Admin');
      });

      it('should handle email with numbers', () => {
        expect(NameExtractor.extractName('joe.doe123@example.com', undefined))
          .toBe('Joe Doe123');
      });

      it('should handle email with underscores (not replaced)', () => {
        expect(NameExtractor.extractName('joe_doe@example.com', undefined))
          .toBe('Joe_doe');
      });

      it('should handle complex email with dots and numbers', () => {
        expect(NameExtractor.extractName('j.smith2024@example.com', undefined))
          .toBe('J Smith2024');
      });
    });
  });
});
