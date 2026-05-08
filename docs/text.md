文本llm 调用
```json
part { type: 'start' }
part {
  type: 'start-step',
  request: {
    body: {
      model: 'deepseek-chat',
      logit_bias: undefined,
      logprobs: undefined,
      top_logprobs: undefined,
      user: undefined,
      parallel_tool_calls: undefined,
      max_tokens: undefined,
      temperature: 0.5,
      top_p: undefined,
      frequency_penalty: undefined,
      presence_penalty: undefined,
      response_format: undefined,
      stop: undefined,
      seed: undefined,
      verbosity: undefined,
      max_completion_tokens: undefined,
      store: undefined,
      metadata: undefined,
      prediction: undefined,
      reasoning_effort: undefined,
      service_tier: undefined,
      prompt_cache_key: undefined,
      prompt_cache_retention: undefined,
      safety_identifier: undefined,
      messages: [Array],
      tools: [Array],
      tool_choice: 'auto',
      stream: true,
      stream_options: [Object]
    }
  },
  warnings: []
}
part { type: 'text-start', id: '0' }
part {
  type: 'text-delta',
  id: '0',
  text: '你好',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '！', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '我是',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: ' Claude',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '，', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '很高兴',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '为你',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '服务',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '！', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '😊',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '\n\n',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '请问',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '有什么',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '我可以',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '帮助',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '你的',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '吗', providerMetadata: undefined }
part { type: 'text-delta', id: '0', text: '？', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '无论是',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '回答问题',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '、', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '分析',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '问题',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '、', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '浏览',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '网页',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '，', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '还是',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '其他',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '任务',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '，', providerMetadata: undefined }
part { type: 'text-delta', id: '0', text: '我', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '都很',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '乐意',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '协助',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '你', providerMetadata: undefined }
part { type: 'text-delta', id: '0', text: '！', providerMetadata: undefined }
part { type: 'text-end', id: '0' }
part {
  type: 'finish-step',
  finishReason: 'stop',
  rawFinishReason: 'stop',
  usage: {
    inputTokens: 5246,
    inputTokenDetails: {
      noCacheTokens: 126,
      cacheReadTokens: 5120,
      cacheWriteTokens: undefined
    },
    outputTokens: 38,
    outputTokenDetails: { textTokens: 38, reasoningTokens: 0 },
    totalTokens: 5284,
    raw: {
      prompt_tokens: 5246,
      completion_tokens: 38,
      total_tokens: 5284,
      prompt_tokens_details: [Object]
    },
    reasoningTokens: 0,
    cachedInputTokens: 5120
  },
  providerMetadata: { openai: {} },
  response: {
    id: '9167e9f1-652c-45f7-ba7c-9590f60e1845',
    timestamp: 2026-05-07T16:49:15.000Z,
    modelId: 'deepseek-v4-flash',
    headers: {
      'access-control-allow-credentials': 'true',
      age: '0',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
      date: 'Thu, 07 May 2026 16:49:15 GMT',
      'eo-cache-status': 'MISS',
      'eo-log-uuid': '7083293694677297497',
      server: 'openresty',
      'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
      'transfer-encoding': 'chunked',
      vary: 'origin, access-control-request-method, access-control-request-headers',
      'x-content-type-options': 'nosniff',
      'x-ds-trace-id': '7df50686fea9a1c57efbb369c29793b6'
    }
  }
}
part {
  type: 'finish',
  finishReason: 'stop',
  rawFinishReason: 'stop',
  totalUsage: {
    inputTokens: 5246,
    inputTokenDetails: {
      noCacheTokens: 126,
      cacheReadTokens: 5120,
      cacheWriteTokens: undefined
    },
    outputTokens: 38,
    outputTokenDetails: { textTokens: 38, reasoningTokens: 0 },
    totalTokens: 5284,
    reasoningTokens: 0,
    cachedInputTokens: 5120
  }
}
```

工具调用:
```json

part { type: 'start' }
part {
  type: 'start-step',
  request: {
    body: {
      model: 'deepseek-chat',
      logit_bias: undefined,
      logprobs: undefined,
      top_logprobs: undefined,
      user: undefined,
      parallel_tool_calls: undefined,
      max_tokens: undefined,
      temperature: 0.5,
      top_p: undefined,
      frequency_penalty: undefined,
      presence_penalty: undefined,
      response_format: undefined,
      stop: undefined,
      seed: undefined,
      verbosity: undefined,
      max_completion_tokens: undefined,
      store: undefined,
      metadata: undefined,
      prediction: undefined,
      reasoning_effort: undefined,
      service_tier: undefined,
      prompt_cache_key: undefined,
      prompt_cache_retention: undefined,
      safety_identifier: undefined,
      messages: [Array],
      tools: [Array],
      tool_choice: 'auto',
      stream: true,
      stream_options: [Object]
    }
  },
  warnings: []
}
part { type: 'text-start', id: '0' }
part {
  type: 'text-delta',
  id: '0',
  text: '好的',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '，', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '我来',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '打开',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '百度',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '。', providerMetadata: undefined }
part {
  type: 'tool-input-start',
  id: 'call_00_DXg82rIYAoEodH1YTci00575',
  toolName: 'playwright__browser_navigate',
  dynamic: false,
  title: undefined
}
part {
  type: 'tool-input-delta',
  id: 'call_00_DXg82rIYAoEodH1YTci00575',
  delta: '{'
}
part {
  type: 'tool-input-delta',
  id: 'call_00_DXg82rIYAoEodH1YTci00575',
  delta: '"'
}
part {
  type: 'tool-input-delta',
  id: 'call_00_DXg82rIYAoEodH1YTci00575',
  delta: 'url'
}
part {
  type: 'tool-input-delta',
  id: 'call_00_DXg82rIYAoEodH1YTci00575',
  delta: '"'
}
part {
  type: 'tool-input-delta',
  id: 'call_00_DXg82rIYAoEodH1YTci00575',
  delta: ': '
}
part {
  type: 'tool-input-delta',
  id: 'call_00_DXg82rIYAoEodH1YTci00575',
  delta: '"'
}
part {
  type: 'tool-input-delta',
  id: 'call_00_DXg82rIYAoEodH1YTci00575',
  delta: 'https'
}
part {
  type: 'tool-input-delta',
  id: 'call_00_DXg82rIYAoEodH1YTci00575',
  delta: '://'
}
part {
  type: 'tool-input-delta',
  id: 'call_00_DXg82rIYAoEodH1YTci00575',
  delta: 'www'
}
part {
  type: 'tool-input-delta',
  id: 'call_00_DXg82rIYAoEodH1YTci00575',
  delta: '.ba'
}
part {
  type: 'tool-input-delta',
  id: 'call_00_DXg82rIYAoEodH1YTci00575',
  delta: 'idu'
}
part {
  type: 'tool-input-delta',
  id: 'call_00_DXg82rIYAoEodH1YTci00575',
  delta: '.com'
}
part {
  type: 'tool-input-delta',
  id: 'call_00_DXg82rIYAoEodH1YTci00575',
  delta: '"'
}
part {
  type: 'tool-input-delta',
  id: 'call_00_DXg82rIYAoEodH1YTci00575',
  delta: '}'
}
part { type: 'tool-input-end', id: 'call_00_DXg82rIYAoEodH1YTci00575' }
part {
  type: 'tool-call',
  toolCallId: 'call_00_DXg82rIYAoEodH1YTci00575',
  toolName: 'playwright__browser_navigate',
  input: { url: 'https://www.baidu.com' },
  providerExecuted: undefined,
  providerMetadata: undefined,
  title: undefined
}
part { type: 'text-end', id: '0' }
part {
  type: 'tool-result',
  toolCallId: 'call_00_DXg82rIYAoEodH1YTci00575',
  toolName: 'playwright__browser_navigate',
  input: { url: 'https://www.baidu.com' },
  output: { content: [ [Object] ] },
  dynamic: false
}
part {
  type: 'finish-step',
  finishReason: 'tool-calls',
  rawFinishReason: 'tool_calls',
  usage: {
    inputTokens: 5278,
    inputTokenDetails: {
      noCacheTokens: 30,
      cacheReadTokens: 5248,
      cacheWriteTokens: undefined
    },
    outputTokens: 59,
    outputTokenDetails: { textTokens: 59, reasoningTokens: 0 },
    totalTokens: 5337,
    raw: {
      prompt_tokens: 5278,
      completion_tokens: 59,
      total_tokens: 5337,
      prompt_tokens_details: [Object]
    },
    reasoningTokens: 0,
    cachedInputTokens: 5248
  },
  providerMetadata: { openai: {} },
  response: {
    id: 'b2aff74d-adf9-4922-8faa-44c7c87755dd',
    timestamp: 2026-05-07T16:51:24.000Z,
    modelId: 'deepseek-v4-flash',
    headers: {
      'access-control-allow-credentials': 'true',
      age: '0',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
      date: 'Thu, 07 May 2026 16:51:24 GMT',
      'eo-cache-status': 'MISS',
      'eo-log-uuid': '18374122766743724742',
      server: 'openresty',
      'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
      'transfer-encoding': 'chunked',
      vary: 'origin, access-control-request-method, access-control-request-headers',
      'x-content-type-options': 'nosniff',
      'x-ds-trace-id': '9c6a91d83c4e1cddab7b2edfa5b9d1e3'
    }
  }
}
part {
  type: 'start-step',
  request: {
    body: {
      model: 'deepseek-chat',
      logit_bias: undefined,
      logprobs: undefined,
      top_logprobs: undefined,
      user: undefined,
      parallel_tool_calls: undefined,
      max_tokens: undefined,
      temperature: 0.5,
      top_p: undefined,
      frequency_penalty: undefined,
      presence_penalty: undefined,
      response_format: undefined,
      stop: undefined,
      seed: undefined,
      verbosity: undefined,
      max_completion_tokens: undefined,
      store: undefined,
      metadata: undefined,
      prediction: undefined,
      reasoning_effort: undefined,
      service_tier: undefined,
      prompt_cache_key: undefined,
      prompt_cache_retention: undefined,
      safety_identifier: undefined,
      messages: [Array],
      tools: [Array],
      tool_choice: 'auto',
      stream: true,
      stream_options: [Object]
    }
  },
  warnings: []
}
part { type: 'text-start', id: '0' }
part {
  type: 'text-delta',
  id: '0',
  text: '百度',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '已经',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '打开',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '！', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '这是',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '百度',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '首页',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '的', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '截图',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '：\n\n',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '![',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '百度',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '首页',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '](',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '.', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: 'play',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: 'wright',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '-m',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: 'cp',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '\\',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: 'page',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '-', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '202',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '6', providerMetadata: undefined }
part { type: 'text-delta', id: '0', text: '-', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '05',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '-', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '07',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: 'T', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '16',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '-', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '51',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '-', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '29',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '-', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '059',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: 'Z', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '.png',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: ')\n\n',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '页面',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '标题',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '是', providerMetadata: undefined }
part { type: 'text-delta', id: '0', text: '：', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '**',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '百度',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '一下',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '，', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '你就',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '知道',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '**\n\n',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '请问',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '有什么',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '需要',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '我', providerMetadata: undefined }
part { type: 'text-delta', id: '0', text: '帮', providerMetadata: undefined }
part { type: 'text-delta', id: '0', text: '您', providerMetadata: undefined }
part {
  type: 'text-delta',
  id: '0',
  text: '搜索',
  providerMetadata: undefined
}
part {
  type: 'text-delta',
  id: '0',
  text: '的吗',
  providerMetadata: undefined
}
part { type: 'text-delta', id: '0', text: '？', providerMetadata: undefined }
part { type: 'text-end', id: '0' }
part {
  type: 'finish-step',
  finishReason: 'stop',
  rawFinishReason: 'stop',
  usage: {
    inputTokens: 5483,
    inputTokenDetails: {
      noCacheTokens: 235,
      cacheReadTokens: 5248,
      cacheWriteTokens: undefined
    },
    outputTokens: 59,
    outputTokenDetails: { textTokens: 59, reasoningTokens: 0 },
    totalTokens: 5542,
    raw: {
      prompt_tokens: 5483,
      completion_tokens: 59,
      total_tokens: 5542,
      prompt_tokens_details: [Object]
    },
    reasoningTokens: 0,
    cachedInputTokens: 5248
  },
  providerMetadata: { openai: {} },
  response: {
    id: '933dfde4-71c5-40a2-96e5-651640fdae1d',
    timestamp: 2026-05-07T16:51:28.000Z,
    modelId: 'deepseek-v4-flash',
    headers: {
      'access-control-allow-credentials': 'true',
      age: '0',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'content-type': 'text/event-stream; charset=utf-8',
      date: 'Thu, 07 May 2026 16:51:28 GMT',
      'eo-cache-status': 'MISS',
      'eo-log-uuid': '12723326574028471576',
      server: 'openresty',
      'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
      'transfer-encoding': 'chunked',
      vary: 'origin, access-control-request-method, access-control-request-headers',
      'x-content-type-options': 'nosniff',
      'x-ds-trace-id': 'f08ab14bb5586c85ca837ec6ee50008f'
    }
  }
}
part {
  type: 'finish',
  finishReason: 'stop',
  rawFinishReason: 'stop',
  totalUsage: {
    inputTokens: 10761,
    inputTokenDetails: {
      noCacheTokens: 265,
      cacheReadTokens: 10496,
      cacheWriteTokens: undefined
    },
    outputTokens: 118,
    outputTokenDetails: { textTokens: 118, reasoningTokens: 0 },
    totalTokens: 10879,
    reasoningTokens: 0,
    cachedInputTokens: 10496
  }
}
```