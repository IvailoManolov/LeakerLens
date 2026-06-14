# Pattern attribution

The detection patterns in this directory (`src/engine/rules/catalog/*.ts`) are **adapted from
[gitleaks](https://github.com/gitleaks/gitleaks)** (`config/gitleaks.toml`), which is distributed
under the MIT License. We translated the Go RE2 patterns to JavaScript global regular expressions
(adjusting for lookbehind/possessive quantifiers, `\h`, and Unicode `\p{}` classes that RE2 and JS
treat differently) and re-tuned severities, keyword gates, entropy floors, and false-positive
gating to match LeakLens' conservative, precision-first posture. Any errors in translation are ours,
not gitleaks'.

We gratefully credit the **Gitleaks authors** for the underlying pattern research.

## MIT License (gitleaks)

```
MIT License

Copyright (c) 2019 Zachary Rice

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
