/**
 * Example Calculator Module for Synapse Testing
 * 
 * This file is intentionally written with various code patterns
 * to test Synapse AI's capabilities:
 * - Refactoring
 * - Bug finding
 * - Documentation
 * - Type improvements
 * - Performance optimization
 */

class Calc {
    // Add two numbers
    add(a: any, b: any) {
        return a + b;
    }

    // Subtract
    sub(a: number, b: number): number {
        return a - b;
    }

    // Multiply with potential bug
    mul(a: number, b: number) {
        var result = 0;
        for (var i = 0; i < b; i++) {
            result = result + a;
        }
        return result;
    }

    // Divide
    div(a: number, b: number) {
        if (b == 0) {
            console.log("Error: Division by zero");
            return null;
        }
        return a / b;
    }

    // Calculate factorial - could be optimized
    fact(n: number) {
        if (n == 0) return 1;
        return n * this.fact(n - 1);
    }

    // Power function
    pow(base: number, exp: number) {
        let result = 1;
        for (let i = 0; i < exp; i++) {
            result *= base;
        }
        return result;
    }

    // Array sum with potential type issue
    sumArray(arr: any[]) {
        let sum = 0;
        for (let i = 0; i < arr.length; i++) {
            sum += arr[i];
        }
        return sum;
    }

    // Average calculation
    average(numbers: number[]) {
        var sum = this.sumArray(numbers);
        return sum / numbers.length;
    }
}

// Export for use
module.exports = { Calc };

// Example usage (not exported)
const c = new Calc();
console.log("2 + 3 =", c.add(2, 3));
console.log("10 / 0 =", c.div(10, 0)); // Edge case
