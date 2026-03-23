import { __as_test_json_value, describe, expect, log, run, test } from "..";

class Address {
  line1: string = "42 Binary Lane";
  zip: i32 = 90210;

  __as_test_json(): string {
    return (
      '{"line1":' +
      __as_test_json_value<string>(this.line1) +
      ',"zip":' +
      __as_test_json_value<i32>(this.zip) +
      "}"
    );
  }
}

class UserProfile {
  id: i32 = 7;
  active: bool = true;
  rating: f64 = 4.25;
  tags: string[] = ["assemblyscript", "testing"];
  address: Address = new Address();

  __as_test_json(): string {
    return (
      '{"id":' +
      __as_test_json_value<i32>(this.id) +
      ',"active":' +
      __as_test_json_value<bool>(this.active) +
      ',"rating":' +
      __as_test_json_value<f64>(this.rating) +
      ',"tags":' +
      __as_test_json_value<string[]>(this.tags) +
      ',"address":' +
      __as_test_json_value<Address>(this.address) +
      "}"
    );
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
