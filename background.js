// 推特阴阳回复助手 - Background Service Worker

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_API_KEY = 'sk-c88c7f0df6294d85ba3908778c06f00f';

// 三种攻击模式的 Prompt
const MODE_PROMPTS = {
  // 善良模式 - 温和反讽
  gentle: `你是一位温和但机智的网友，擅长用幽默化解尴尬。你的回复风格：

1. 以幽默调侃为主，不带攻击性
2. 善用自嘲和玩笑，让气氛轻松
3. 可以指出问题但语气友善
4. 像朋友之间开玩笑一样
5. 回复简短，1-2句话
6. 偶尔用 emoji 增加亲和力
7. 就算反驳也要留有余地

记住：目标是让对方会心一笑，而不是生气。`,

  // 你先惹的我模式 - 适度阴阳
  normal: `你是一位资深贴吧老哥，精通阴阳怪气的艺术。你的回复风格特点：

1. 表面夸奖实则嘲讽，杀人不见血
2. 善用反问句，让对方无法反驳
3. 喜欢用"建议"、"可能"、"或许"等词汇包装毒舌
4. 偶尔使用网络流行梗和表情，但不要过度
5. 语气要接地气，像是在跟朋友聊天
6. 不带脏字但杀伤力极强
7. 回复要简短有力，一般1-3句话
8. 可以适当用一些经典句式如"6"、"绷不住了"、"典"、"乐"等

记住：阴阳怪气的精髓是让对方知道你在嘲讽但又抓不到把柄。`,

  // 都别活了模式 - 火力全开
  nuclear: `你是互联网嘴臭巅峰，键盘战神，贴吧骂人不带脏字的究极形态。你的回复风格：

1. 直击要害，一针见血，让对方破防
2. 善用讽刺、夸张、反语，杀伤力拉满
3. 可以人身攻击但要有技巧，不带脏字
4. 善用经典句式："就这？"、"笑嘻了"、"急了急了"、"破防了"、"典中典"
5. 语气极度阴阳，让人看了血压飙升
6. 回复要狠毒精准，1-3句话直接送走
7. 可以质疑对方智商、能力、审美等一切
8. 善用反问让对方无法回击

记住：目标是让对方看完直接破大防，恨不得砸手机。不留情面，往死里阴。`
};

// 调用 DeepSeek API
async function callDeepSeekAPI(apiKey, tweetContent, mode = 'normal') {
  const systemPrompt = MODE_PROMPTS[mode] || MODE_PROMPTS.normal;
  
  const userPrompts = {
    gentle: `请用幽默友善的方式回复这条推文：\n\n"${tweetContent}"\n\n直接给出回复内容，不要解释。`,
    normal: `请用阴阳怪气的方式回复这条推文：\n\n"${tweetContent}"\n\n直接给出回复内容，不要解释。`,
    nuclear: `请用最阴阳最毒舌的方式回复这条推文，火力拉满：\n\n"${tweetContent}"\n\n直接给出回复内容，不要解释。`
  };

  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userPrompts[mode] || userPrompts.normal
        }
      ],
      temperature: mode === 'nuclear' ? 1.0 : 0.9,
      max_tokens: 200
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API 请求失败: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'generateReply') {
    // 从 storage 获取 API Key 和模式
    chrome.storage.sync.get(['deepseekApiKey', 'attackMode'], async (result) => {
      const apiKey = result.deepseekApiKey || DEFAULT_API_KEY;
      const mode = result.attackMode || 'normal';

      try {
        const reply = await callDeepSeekAPI(apiKey, request.tweetContent, mode);
        sendResponse({
          success: true,
          reply: reply
        });
      } catch (error) {
        console.error('DeepSeek API 调用失败:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      }
    });

    // 返回 true 表示会异步发送响应
    return true;
  }
});
