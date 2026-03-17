/**
 * Extract verification codes (4-8 digit/alphanumeric) from text.
 * Covers common formats across English, Chinese, Japanese, Korean.
 */
export function extractCode(text: string): string | null {
  const patterns = [
    // "验证码：123456" / "verification code: 123456" / "認証コード：123456" / "인증 코드: 123456"
    /(?:验证码|verification\s*code|認証コード|确认码|confirm(?:ation)?\s*code|security\s*code|passcode|OTP|pin\s*code|인증\s*코드|코드)[:\s：\-]+([A-Za-z0-9]{4,8})/i,
    // "code is 123456" / "code: 123456"
    /\bcode\s*(?:is|:)\s*([A-Za-z0-9]{4,8})/i,
    // Standalone 4-8 digit number (surrounded by whitespace/boundaries)
    /(?:^|\s)(\d{4,8})(?:\s|$|\.|,)/m,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1]
  }

  return null
}
