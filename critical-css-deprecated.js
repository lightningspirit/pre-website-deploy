#!/usr/bin/env node

console.warn(`*****
Warning: this tool does not generate Critical CSS anymore.
Please consider using a different script to generate Critical CSS before running this script.
*****`);

require('child_process').fork('./inject-nonces.js');
