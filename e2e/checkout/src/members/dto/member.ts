// Hand-written in the rune-manifest output style (the members module has no .rune spec —
// it exists to compose with checkout and prove the $memberId contract snaps together).

import { IsString } from "class-validator";

// the minted member — memberId matches checkout's [TYP:ext] external input by name
export class MemberDto {
  @IsString()
  memberId!: string;
}
