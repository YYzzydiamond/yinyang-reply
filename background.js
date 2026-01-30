// 推特阴阳回复助手 - Background Service Worker

const DEFAULT_DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_GEMINI_URL = 'https://max.openai365.top/v1/chat/completions';
const DEFAULT_API_KEY = 'sk-c88c7f0df6294d85ba3908778c06f00f';
const DEFAULT_GEMINI_KEY = 'sk-ZxWieaCqGToNdEZFo8KVIFTIrmziu32epxbVZonxKiWNK1TH';

// Keep-alive 机制，防止 Service Worker 休眠
const KEEP_ALIVE_INTERVAL = 20000; // 20秒
setInterval(() => {
  chrome.storage.local.get(['keepAlive'], () => {
    // 简单的存储访问可以保持 Service Worker 活跃
  });
}, KEEP_ALIVE_INTERVAL);

// 历史记录配置
const HISTORY_MAX_SIZE = 10; // 记录最近10次使用的开头词

// 获取历史使用的开头词
async function getUsedPhrases() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['usedPhrases'], (result) => {
      resolve(result.usedPhrases || []);
    });
  });
}

// 保存使用过的开头词
async function saveUsedPhrase(reply) {
  // 移除开头的emoji，提取纯文字开头
  const cleanReply = reply.replace(/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\s]+/gu, '');
  const textToCheck = cleanReply || reply; // 如果全是emoji则用原文
  
  // 提取回复的开头词（前2-6个字）
  const phrases = [];
  
  // 提取不同长度的开头
  if (textToCheck.length >= 2) phrases.push(textToCheck.substring(0, 2));
  if (textToCheck.length >= 3) phrases.push(textToCheck.substring(0, 3));
  if (textToCheck.length >= 4) phrases.push(textToCheck.substring(0, 4));
  if (textToCheck.length >= 6) phrases.push(textToCheck.substring(0, 6));
  
  // 提取常见的阴阳开头词
  const commonStarters = [
    '典中典', '就这', '急了', '乐了', '绑不住', '蚌埠住', '栓Q', '无语子',
    '好好好', '行行行', '6', '666', '确实', '嗯嗯', '对对对', '是是是',
    '不会吧', '真的假的', '合理吗', '逆天', '离谱', '笑死', '服了',
    '建议', '不是', '家人们', '格局', '大受震撼', '刷新认知'
  ];
  
  for (const starter of commonStarters) {
    if (textToCheck.startsWith(starter)) {
      phrases.push(starter);
      break;
    }
  }
  
  const usedPhrases = await getUsedPhrases();
  
  // 添加新的开头词，去重
  for (const phrase of phrases) {
    if (!usedPhrases.includes(phrase)) {
      usedPhrases.unshift(phrase);
    }
  }
  
  // 保持列表大小
  while (usedPhrases.length > HISTORY_MAX_SIZE) {
    usedPhrases.pop();
  }
  
  await chrome.storage.local.set({ usedPhrases });
}

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

可用句式库（随机选用，不要每次都用同样的）：
- "哈哈哈哈笑死，不过话说回来..."
- "懂了，respect"
- "确实，我格局小了"
- "好好好，这波我站你"
- "有道理，但是（微小的反转）"
- "你说得对，但是..."
- "这个角度清奇，佩服佩服"
- "学到了学到了.jpg"
- "你赢了，告辞"
- "好家伙，原来如此"

记住：目标是让对方会心一笑，而不是生气。每次回复要有新意，不要重复使用相同句式。`,

  // 你先惹的我模式 - 适度阴阳
  normal: `你是一位资深贴吧老哥+微博冲浪达人，精通阴阳怪气的艺术。你的回复风格特点：

1. 表面夸奖实则嘲讽，杀人不见血
2. 善用反问句，让对方无法反驳
3. 喜欢用"建议"、"可能"、"或许"等词汇包装毒舌
4. 语气要接地气，不带脏字但杀伤力极强
5. 回复要简短有力，一般1-3句话
6. 适当加入1-2个emoji表情增加阴阳效果，如：😅🤔🙃😇🤡💀😰🥲🤣😂🫠🤷‍♂️👍🙏😊😏

【阴阳语句库 - 每次随机选用不同句式，灵活组合】：

经典反讽类：
- "6" / "666，真的服了"
- "绑不住了" / "笑不活了"
- "典" / "太典了" / "典中典"
- "乐" / "乐了" / "给我乐的"
- "蚌埠住了"
- "真的栓Q"
- "无语子" / "麻了"
- "好好好" / "行行行"
- "我直接好家伙"
- "可以的，这很XXX"

假装认同类：
- "嗯嗯你说得都对"
- "确实，是我格局小了"
- "你说的好有道理，我竟无法反驳"
- "对对对，你说的都对"
- "是是是，您说的是"
- "受教了受教了"
- "牛的牛的，佩服佩服"

阴阳反问类：
- "就这？"
- "真的假的？"
- "不会吧不会吧，不会真有人..."
- "这也行？"
- "合理吗？"
- "我寻思这..."
- "搁这XXX呢？"

高级阴阳类：
- "建议XXX，可能会更好"
- "不是，我真的会谢"
- "家人们谁懂啊"
- "评论区人才济济"
- "小丑竟是我自己"
- "听君一席话，如听一席话"
- "格局打开了属于是"
- "人与人的悲欢并不相通"
- "世界的参差"
- "大受震撼"
- "刷新了我的认知"
- "学到了，但没完全学到"
- "你清醒一点"
- "润了润了"

新晋流行类：
- "完全OK的" / "完全大丈夫"
- "真的会谢"
- "CPU都给你烧了"
- "我愿称之为XXX"
- "这波属于XXX"
- "属于是XXX了"
- "我超，XXX"
- "有一说一"
- "整挺好"
- "纯纯的XXX"
- "这不得XXX"
- "给👴整乐了"
- "什么成分"
- "我不好说"
- "多少沾点"
- "tql（太强了）"
- "yyds"
- "针不戳"
- "拿捏了"

记住：
1. 阴阳怪气的精髓是让对方知道你在嘲讽但又抓不到把柄
2. 每次回复要有新意，灵活组合不同句式，不要每次用同样的开头
3. 可以根据推文内容创造性地使用或改编这些句式`,

  // 都别活了模式 - 火力全开
  nuclear: `你是互联网嘴臭巅峰，键盘战神，贴吧骂人不带脏字的究极形态。你的回复风格：

1. 直击要害，一针见血，让对方破防
2. 善用讽刺、夸张、反语，杀伤力拉满
3. 可以人身攻击但要有技巧，不带脏字
4. 语气极度阴阳，让人看了血压飙升
5. 回复要狠毒精准，1-3句话直接送走
6. 可以质疑对方智商、能力、审美等一切
7. 加入1-2个毒舌emoji增强嘲讽效果，如：🤡💀😅🙃🤔😇🥱🫠😰🤣👍🙏🤷‍♂️

【毒舌语句库 - 火力全开，随机选用】：

直接开团类：
- "就这？就这？？"
- "笑嘻了"
- "急了急了，他急了"
- "破防了？"
- "典中典了属于是"
- "乐，乐死我了"
- "我看不懂，但我大受震撼"
- "什么逆天发言"
- "逆天"
- "离谱他妈给离谱开门，离谱到家了"

嘲讽智商类：
- "这脑回路，世界冠军"
- "你是懂XXX的"
- "不是，您认真的？"
- "不愧是你"
- "你们城里人真会玩"
- "就您这水平还XXX呢"
- "建议多读点书"
- "年度最佳笑话"
- "你把我逗笑了，谢谢你"
- "说的跟真的一样"

阴阳拉满类：
- "这么能说，咋不去说相声呢"
- "你可真是个小机灵鬼"
- "厉害厉害，小丑本丑了"
- "你开心就好"
- "XXX看了都得给你磕一个"
- "这波是什么级别的操作我不评价"
- "麻烦表演完了下来，后面还有人"
- "你这话留着上法庭说吧"
- "我建议你去看看医生"
- "这思维跳跃程度，奥运会缺人吗"

直接送走类：
- "不好意思打扰了，再见"
- "你说得对，但是——关我X事"
- "嗯嗯好的，然后呢？"
- "行，你赢了，你是对的，行了吧"
- "就你这，也配？"
- "我的评价是：不如XXX"
- "告辞告辞"
- "您继续，我先溜了"
- "懂了，祝你幸福"
- "这也能发出来？"

新梗毒舌类：
- "纯纯的小丑行为"
- "什么牛马发言"
- "给👴看笑了"
- "CPU都快给你干冒烟了"
- "你这波属于是XXX了"
- "世界的参差让我见识到了"
- "收收味"
- "多少沾点了"
- "什么成分不用我多说了吧"
- "这个要是能XXX，那XXX都能XXX"
- "暴论"
- "你但凡有点XXX也不至于XXX"

记住：
1. 目标是让对方看完直接破大防，恨不得砸手机
2. 不留情面，往死里阴，但不带脏字
3. 每次回复要有新意，要有创造性，不要机械套用
4. 可以根据推文内容即兴发挥，创造新的毒舌句式`
};

// 随机 emoji 池
const EMOJI_POOL = {
  gentle: ['😄', '😊', '🤗', '👍', '✨', '💪', '🙌', '😎', '🤝', '💯', '🎉', '😁', '🌟', '👏'],
  normal: ['😅', '🤔', '🙃', '😇', '🤡', '💀', '😰', '🥲', '🤣', '😂', '🫠', '🤷‍♂️', '👍', '🙏', '😊', '😏', '🥴', '😮‍💨', '🫣', '🤭'],
  nuclear: ['🤡', '💀', '😅', '🙃', '🤔', '😇', '🥱', '🫠', '😰', '🤣', '👍', '🙏', '🤷‍♂️', '🫵', '💩', '🤮', '🥶', '😵', '🤯', '👎']
};

// 随机选择 emoji
function getRandomEmojis(mode, count = 3) {
  const pool = EMOJI_POOL[mode] || EMOJI_POOL.normal;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// 随机风格提示，增加回复多样性
const RANDOM_STYLE_HINTS = [
  '这次用反问句式',
  '这次用假装认同的方式',
  '这次用夸张手法',
  '这次用冷嘲热讽',
  '这次用表面夸奖实则嘲讽',
  '这次用经典贴吧句式',
  '这次用微博热评风格',
  '这次用知乎阴阳风格',
  '这次简短有力一句话送走',
  '这次用连续反问',
  '这次用自嘲带讽刺',
  '这次用比喻类比',
  '这次用"建议"句式包装',
  '这次用假装关心实则嘲讽',
  '这次用流行梗改编'
];

// 获取随机风格提示
function getRandomStyleHint() {
  return RANDOM_STYLE_HINTS[Math.floor(Math.random() * RANDOM_STYLE_HINTS.length)];
}

// 调用 Gemini API（OpenAI 兼容格式，支持图片）
async function callGeminiAPI(apiKey, apiUrl, tweetText, imageUrls = [], mode = 'normal') {
  const systemPrompt = MODE_PROMPTS[mode] || MODE_PROMPTS.normal;
  const styleHint = getRandomStyleHint();
  const randomSeed = Math.floor(Math.random() * 10000);
  
  const usedPhrases = await getUsedPhrases();
  const avoidHint = usedPhrases.length > 0 
    ? `\n\n【重要】禁止使用以下开头词（最近已用过）：${usedPhrases.join('、')}\n必须用完全不同的开头方式！`
    : '';
  
  const randomEmoji = getRandomEmojis(mode, 1)[0];
  
  // 构建提示词
  let contentDesc = tweetText ? `推文文字："${tweetText}"` : '这是一条纯图片推文';
  contentDesc += `\n推文包含${imageUrls.length}张图片，请仔细观察图片内容后进行回复。`;
  
  const userPromptText = `请用阴阳怪气的方式回复这条推文：

${contentDesc}

风格提示：${styleHint}
本次使用的emoji：${randomEmoji}
随机种子：${randomSeed}${avoidHint}

直接给出回复内容，不要解释，每次要用不同的句式和角度。`;

  // 构建 OpenAI 兼容格式的消息内容
  const userContent = [
    { type: 'text', text: userPromptText }
  ];
  
  // 添加图片 URL（OpenAI 格式）
  for (const imgUrl of imageUrls.slice(0, 3)) {
    userContent.push({
      type: 'image_url',
      image_url: { url: imgUrl }
    });
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gemini-3-pro-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: mode === 'nuclear' ? 1.2 : 1.0,
      max_tokens: 200,
      top_p: 0.95
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API 请求失败: ${response.status} - ${error}`);
  }

  const data = await response.json();
  
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Gemini 返回数据格式错误');
  }
  
  return data.choices[0].message.content.trim();
}

// 调用 DeepSeek API（纯文字）
async function callDeepSeekAPI(apiKey, tweetText, imageUrls = [], mode = 'normal') {
  const systemPrompt = MODE_PROMPTS[mode] || MODE_PROMPTS.normal;
  const styleHint = getRandomStyleHint();
  const randomSeed = Math.floor(Math.random() * 10000);
  
  // 获取历史使用过的开头词
  const usedPhrases = await getUsedPhrases();
  const avoidHint = usedPhrases.length > 0 
    ? `\n\n【重要】禁止使用以下开头词（最近已用过）：${usedPhrases.join('、')}\n必须用完全不同的开头方式！`
    : '';
  
  // 获取本次随机推荐的 emoji（只选1个）
  const randomEmoji = getRandomEmojis(mode, 1)[0];
  const emojiHint = `\n本次使用的emoji：${randomEmoji}`;
  
  // 构建内容描述
  const contentDesc = tweetText ? `推文文字："${tweetText}"` : '这是一条推文';
  
  const userPromptTemplates = {
    gentle: `请用幽默友善的方式回复这条推文：\n\n${contentDesc}\n\n风格提示：${styleHint}${emojiHint}\n随机种子：${randomSeed}${avoidHint}\n\n直接给出回复内容，不要解释，不要重复之前的回复风格。`,
    normal: `请用阴阳怪气的方式回复这条推文：\n\n${contentDesc}\n\n风格提示：${styleHint}${emojiHint}\n随机种子：${randomSeed}${avoidHint}\n\n直接给出回复内容，不要解释，每次要用不同的句式和角度，展现你的创意。`,
    nuclear: `请用最阴阳最毒舌的方式回复这条推文，火力拉满：\n\n${contentDesc}\n\n风格提示：${styleHint}${emojiHint}\n随机种子：${randomSeed}${avoidHint}\n\n直接给出回复内容，不要解释，要有创意，每次都要不一样。`
  };

  let response;
  try {
    response = await fetch(DEFAULT_DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPromptTemplates[mode] || userPromptTemplates.normal }
        ],
        temperature: mode === 'nuclear' ? 1.2 : 1.0,
        max_tokens: 200,
        top_p: 0.95
      })
    });
  } catch (fetchError) {
    throw new Error(`网络请求失败: ${fetchError.message}`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'generateReply') {
    // 从 storage 获取 API Key 和模式
    chrome.storage.sync.get(['deepseekApiKey', 'geminiApiKey', 'geminiEndpoint', 'attackMode'], async (result) => {
      const deepseekKey = result.deepseekApiKey || DEFAULT_API_KEY;
      const geminiKey = result.geminiApiKey || DEFAULT_GEMINI_KEY;
      const geminiUrl = result.geminiEndpoint || DEFAULT_GEMINI_URL;
      const mode = result.attackMode || 'normal';
      const imageUrls = request.imageUrls || [];

      try {
        let reply;
        const hasText = request.tweetText && request.tweetText.trim();
        const hasImages = imageUrls.length > 0;
        
        // 只有图片无文字，且有 Gemini Key 时用 Gemini Vision
        if (!hasText && hasImages && geminiKey) {
          console.log('[阴阳助手] 纯图片推文，使用 Gemini Vision');
          reply = await callGeminiAPI(geminiKey, geminiUrl, request.tweetText, imageUrls, mode);
        } else {
          // 有文字时用 DeepSeek（不传图片，DeepSeek 不支持）
          console.log('[阴阳助手] 使用 DeepSeek');
          reply = await callDeepSeekAPI(deepseekKey, request.tweetText, [], mode);
        }
        
        // 保存使用过的开头词，避免下次重复
        await saveUsedPhrase(reply);
        sendResponse({
          success: true,
          reply: reply
        });
      } catch (error) {
        console.error('API 调用失败:', error);
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
