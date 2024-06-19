<h5 align="center">
<pre>
 _____ _____     _____ _____ _____ _____ 
|  _  |   __|___|_   _|   __|   __|_   _|
|     |__   |___| | | |   __|__   | | |  
|__|__|_____|     |_| |_____|_____| |_|  
v0.0.1
</pre>
</h5>

## Installation

```bash
npm install as-test
```

## Usage

```js
import {
  describe,
  expect,
  run
} from "as-test";

describe("Should create suite", () => {
  expect("foo").toBe("foo");
  expect(3.14).toBeGreaterThan(0.0);
  expect("a").toBe("b");
});

run();
```

If you use this project in your codebase, consider dropping a [⭐ HERE](https://github.com/JairusSW/as-test). I would really appreciate it!

## Notes

This library is in the EARLY STAGES OF DEVELOPMENT!
If you want a feature, drop an issue (and again, maybe a star). I'll likely add it in less than 7 days.

## Contact

Contact me at:

Email: `me@jairus.dev`

GitHub: `JairusSW`

Discord: `jairussw`

## Issues

Please submit an issue to https://github.com/JairusSW/as-test/issues if you find anything wrong with this library