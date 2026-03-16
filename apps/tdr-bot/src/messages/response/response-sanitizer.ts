import { Injectable } from '@nestjs/common'
import { remark } from 'remark'

import { remarkFixLinkPlugin } from 'src/utils/fix-link'

@Injectable()
export class ResponseSanitizer {
  async sanitizeResponse(content: string): Promise<string> {
    const result = await remark().use(remarkFixLinkPlugin).process(content)
    return result.toString()
  }
}
