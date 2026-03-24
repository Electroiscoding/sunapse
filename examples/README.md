# Synapse Example Workspace

This directory contains example files for testing Synapse AI's capabilities.

## Files

### calculator.ts
A deliberately imperfect calculator implementation to test:
- **Refactoring**: Variable naming, modern syntax
- **Bug Finding**: Division by zero, type issues, logic errors
- **Documentation**: Adding JSDoc comments
- **Type Improvements**: Strict TypeScript types
- **Performance**: Optimizing the multiply and factorial functions

## Suggested Testing Flow

1. **Open calculator.ts** in the editor
2. **Select code** and try these quick actions:
   - 📖 **Explain Code** - Understand the implementation
   - 🐛 **Find Bugs** - Discover edge cases and issues
   - ✨ **Refactor** - Modernize and clean up
   - 📝 **Add Types** - Improve TypeScript definitions
   - 🧪 **Write Tests** - Generate unit tests
   - 📚 **Document** - Add comprehensive documentation

3. **Try natural language queries**:
   - "Fix all bugs in this calculator"
   - "Optimize the factorial function"
   - "Convert to use modern ES6+ features"
   - "Add input validation"

4. **Use Cleft for automation**:
   - Enable Cleft mode
   - Ask: "Refactor all example files and run tests"

## Expected Issues in calculator.ts

- `add()` uses `any` types
- `mul()` has inefficient O(n) algorithm
- `div()` returns null on error (should throw)
- `fact()` has no input validation
- Missing JSDoc comments
- Uses `var` instead of `let`/`const`
- No input validation
- Potential stack overflow in recursive factorial
- `average()` doesn't handle empty arrays

## Learning Outcomes

After using Synapse on this file, you should see:
- Better type safety
- Improved performance
- Comprehensive error handling
- Clear documentation
- Modern JavaScript patterns
