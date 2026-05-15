import { describe, expect, log, run, test } from "..";
// Import JSON directly so json-as transform does not add broken pnpm paths.
import { JSON } from "json-as/assembly";


@json
class Address {
  line1: string = "42 Binary Lane";
  zip: i32 = 90210;

  __as_test_json(): string {
    return JSON.stringify(this);
  }
}


@json
class UserProfile {
  id: i32 = 7;
  active: bool = true;
  rating: f64 = 4.25;
  tags: string[] = ["assemblyscript", "testing"];
  address: Address = new Address();

  __as_test_json(): string {
    return JSON.stringify(this);
  }
}

describe("log serialization", () => {
  test("supports class instances and common value types", () => {
    const profile = new UserProfile();
    const list = [1, 2, 3];

    log(profile);
    log(list);
    log(true);
    log(123);
    log("ok");

    expect(1).toBe(1);
  });
});
