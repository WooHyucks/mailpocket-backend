export class User {
  constructor({ id, identifier = null, password = null, platform = null, platform_id = null, is_member = null }) {
    this.id = id;
    this.identifier = identifier;
    this.password = password;
    this.platform = platform;
    this.platform_id = platform_id;
    this.is_member = is_member;
  }
}


