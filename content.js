// 推特阴阳回复助手 - Content Script

(function() {
  'use strict';

  const BUTTON_CLASS = 'yinyang-reply-btn';
  let isGenerating = false;

  // 获取推文内容（返回对象，包含文字和图片URL）
  function getTweetContent(tweetElement) {
    const result = {
      text: null,
      imageUrls: []
    };
    
    // 获取文字内容
    const tweetText = tweetElement.querySelector('[data-testid="tweetText"]');
    if (tweetText && tweetText.innerText.trim()) {
      result.text = tweetText.innerText.trim();
    }
    
    // 获取图片 URL
    const tweetPhotos = tweetElement.querySelectorAll('[data-testid="tweetPhoto"] img');
    const seenUrls = new Set();
    tweetPhotos.forEach(img => {
      if (img.src && !img.src.includes('profile_images') && !img.src.includes('emoji')) {
        // 获取原图 URL（去掉尺寸参数，使用较大尺寸）
        let imgUrl = img.src;
        // Twitter 图片 URL 格式: https://pbs.twimg.com/media/xxx?format=jpg&name=small
        // 改为 name=medium 获取更清晰的图
        if (imgUrl.includes('name=')) {
          imgUrl = imgUrl.replace(/name=\w+/, 'name=medium');
        }
        // 去重（基于基础URL，不含参数）
        const baseUrl = imgUrl.split('?')[0];
        if (!seenUrls.has(baseUrl)) {
          seenUrls.add(baseUrl);
          result.imageUrls.push(imgUrl);
        }
      }
    });
    
    // 检查是否有视频封面
    const videoPoster = tweetElement.querySelector('[data-testid="videoPlayer"] video');
    if (videoPoster && videoPoster.poster) {
      result.imageUrls.push(videoPoster.poster);
      if (!result.text) {
        result.text = '[视频推文]';
      }
    }
    
    // 检查是否有 GIF
    const gifImg = tweetElement.querySelector('[data-testid="gifPlayer"] img');
    if (gifImg && gifImg.src) {
      result.imageUrls.push(gifImg.src);
      if (!result.text) {
        result.text = '[GIF推文]';
      }
    }
    
    // 检查是否有引用推文
    const quoteTweet = tweetElement.querySelector('[data-testid="quoteTweet"]');
    if (quoteTweet) {
      const quoteText = quoteTweet.querySelector('[data-testid="tweetText"]');
      if (quoteText && quoteText.innerText.trim()) {
        result.text = (result.text ? result.text + '\n' : '') + `[引用: ${quoteText.innerText.trim()}]`;
      }
      // 引用推文中的图片
      const quoteImg = quoteTweet.querySelector('img[src*="twimg.com/media"]');
      if (quoteImg) {
        result.imageUrls.push(quoteImg.src);
      }
    }
    
    // 如果既没有文字也没有图片，返回 null
    if (!result.text && result.imageUrls.length === 0) {
      return null;
    }
    
    return result;
  }

  // 生成回复
  async function generateReply(tweetContent) {
    console.log('[阴阳助手] 开始生成回复，推文内容:', tweetContent);
    return new Promise((resolve, reject) => {
      // 检查 chrome.runtime 是否可用（Service Worker 可能已休眠）
      if (!chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error('扩展已断开连接，请刷新页面后重试'));
        return;
      }
      
      try {
        chrome.runtime.sendMessage({
          action: 'generateReply',
          tweetText: tweetContent.text,
          imageUrls: tweetContent.imageUrls
        }, (response) => {
          console.log('[阴阳助手] 收到响应:', response);
          
          // 检查运行时错误
          if (chrome.runtime.lastError) {
            console.error('[阴阳助手] 运行时错误:', chrome.runtime.lastError);
            reject(new Error('扩展通信失败，请刷新页面后重试'));
            return;
          }
          
          // 检查响应是否存在
          if (!response) {
            reject(new Error('未收到响应，请刷新页面后重试'));
            return;
          }
          
          // 检查响应状态
          if (response.success) {
            resolve(response.reply);
          } else {
            reject(new Error(response.error || '生成失败，请重试'));
          }
        });
      } catch (e) {
        console.error('[阴阳助手] 发送消息异常:', e);
        reject(new Error('扩展通信异常，请刷新页面后重试'));
      }
    });
  }

  // 点击推文的回复按钮，打开回复框
  function clickReplyButton(tweetElement) {
    const replyBtn = tweetElement.querySelector('[data-testid="reply"]');
    if (replyBtn) {
      replyBtn.click();
      return true;
    }
    return false;
  }

  // 等待回复框出现
  function waitForReplyBox(timeout = 5000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const check = () => {
        // 尝试多种选择器
        const replyBox = document.querySelector('[data-testid="tweetTextarea_0"]') ||
                        document.querySelector('[data-testid="tweetTextarea_1"]') ||
                        document.querySelector('div[data-testid="tweetTextarea_0RichTextInputContainer"]') ||
                        document.querySelector('div[role="textbox"][contenteditable="true"]') ||
                        document.querySelector('.public-DraftEditor-content[contenteditable="true"]') ||
                        document.querySelector('[data-contents="true"]');
        
        console.log('[阴阳助手] 查找回复框:', replyBox);
        
        if (replyBox) {
          resolve(replyBox);
        } else if (Date.now() - startTime > timeout) {
          reject(new Error('回复框加载超时'));
        } else {
          setTimeout(check, 200);
        }
      };
      check();
    });
  }

  // 检查内容是否已填入
  function isContentFilled(element, text) {
    const content = element.textContent.trim();
    if (!content) return false;
    // 检查前几个字符是否匹配（排除emoji干扰）
    const cleanText = text.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu, '');
    const cleanContent = content.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}]/gu, '');
    const checkStr = cleanText.substring(0, Math.min(5, cleanText.length));
    return cleanContent.includes(checkStr);
  }

  // 填入回复内容
  async function fillReplyContent(replyBox, text) {
    console.log('[阴阳助手] 开始填入内容:', text);
    
    // 找到实际可编辑的元素
    let editableElement = replyBox;
    if (!replyBox.getAttribute('contenteditable')) {
      editableElement = replyBox.querySelector('[contenteditable="true"]') || 
                       replyBox.querySelector('[role="textbox"]') ||
                       replyBox;
    }
    
    console.log('[阴阳助手] 可编辑元素:', editableElement);
    
    // 聚焦
    editableElement.focus();
    await new Promise(r => setTimeout(r, 100));
    
    // 方法1: execCommand insertText（最简单直接）
    console.log('[阴阳助手] 尝试方法1: execCommand');
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
    await new Promise(r => setTimeout(r, 200));
    
    // 检查是否成功
    if (isContentFilled(editableElement, text)) {
      console.log('[阴阳助手] 方法1成功');
    } else {
      // 方法2: 使用 beforeinput 事件
      console.log('[阴阳助手] 方法1失败，尝试方法2: beforeinput');
      try {
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('text/plain', text);
        
        const pasteEvent = new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertFromPaste',
          data: text,
          dataTransfer: dataTransfer
        });
        editableElement.dispatchEvent(pasteEvent);
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.log('[阴阳助手] beforeinput 方式失败:', e);
      }
    }
    
    // 再次检查
    if (isContentFilled(editableElement, text)) {
      console.log('[阴阳助手] 内容已填入');
    } else {
      // 方法3: 直接设置 innerHTML（最后手段）
      console.log('[阴阳助手] 尝试方法3: 直接设置内容');
      const span = editableElement.querySelector('span[data-text="true"]');
      if (span) {
        span.textContent = text;
      } else {
        // 创建 Draft.js 需要的结构
        editableElement.innerHTML = `<div data-block="true"><div data-offset-key="0"><span data-offset-key="0"><span data-text="true">${text}</span></span></div></div>`;
      }
    }
    
    // 触发 input 事件确保状态更新
    editableElement.dispatchEvent(new InputEvent('input', { 
      bubbles: true, 
      composed: true,
      inputType: 'insertText',
      data: text
    }));
    
    // 等待 Draft.js 处理
    await new Promise(r => setTimeout(r, 300));
    
    console.log('[阴阳助手] 填入完成，当前内容:', editableElement.textContent);
  }

  // 点击发送按钮（带重试）
  async function clickSendButton() {
    // 多次尝试点击发送按钮
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 300));
      
      const sendBtn = document.querySelector('[data-testid="tweetButton"]') ||
                     document.querySelector('[data-testid="tweetButtonInline"]');
      
      console.log(`[阴阳助手] 尝试发送 ${i + 1}/5，按钮状态:`, sendBtn ? (sendBtn.disabled ? '禁用' : '可用') : '未找到');
      
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
        console.log('[阴阳助手] 已点击发送按钮');
        return true;
      }
    }
    
    console.log('[阴阳助手] 发送按钮未能启用，内容已填入，请手动发送');
    return false;
  }

  // 处理阴阳回复按钮点击
  async function handleYinYangClick(e) {
    e.preventDefault();
    e.stopPropagation();

    console.log('[阴阳助手] 按钮被点击');

    if (isGenerating) {
      console.log('[阴阳助手] 正在生成中，忽略点击');
      return;
    }

    const btn = e.target.closest('.' + BUTTON_CLASS);
    if (!btn) {
      console.log('[阴阳助手] 找不到按钮元素');
      return;
    }

    // 从按钮的data属性获取推文元素，或者通过DOM查找
    const tweetElement = btn._tweetElement || btn.closest('article');
    if (!tweetElement) {
      console.log('[阴阳助手] 找不到推文元素');
      alert('找不到推文');
      return;
    }
    console.log('[阴阳助手] 找到推文元素:', tweetElement);

    const tweetContent = getTweetContent(tweetElement);
    console.log('[阴阳助手] 获取到推文内容:', tweetContent);
    if (!tweetContent || (!tweetContent.text && tweetContent.imageUrls.length === 0)) {
      alert('找不到推文内容');
      return;
    }

    isGenerating = true;
    const originalHTML = btn.innerHTML;
    btn.innerHTML = `<span style="font-size: 14px;">⏳</span>`;
    btn.style.opacity = '0.6';
    btn.style.pointerEvents = 'none';

    try {
      // 1. 生成回复内容
      const reply = await generateReply(tweetContent);

      // 2. 点击回复按钮打开回复框
      if (!clickReplyButton(tweetElement)) {
        throw new Error('找不到回复按钮');
      }

      // 3. 等待回复框出现
      const replyBox = await waitForReplyBox();

      // 4. 填入内容
      await fillReplyContent(replyBox, reply);

      // 5. 自动发送
      await clickSendButton();

    } catch (error) {
      console.error('阴阳回复错误:', error);
      alert('生成失败: ' + error.message);
    } finally {
      isGenerating = false;
      btn.innerHTML = originalHTML;
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
    }
  }

  // 创建阴阳回复按钮
  function createYinYangButton() {
    const btn = document.createElement('div');
    btn.className = BUTTON_CLASS;
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <path d="M12 2a10 10 0 0 1 0 20 5 5 0 0 1 0-10 5 5 0 0 0 0-10z"/>
        <circle cx="12" cy="7" r="1.5" fill="#fff"/>
        <circle cx="12" cy="17" r="1.5"/>
      </svg>
    `;
    btn.title = '阴阳回复';
    btn.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      cursor: pointer;
      transition: all 0.15s ease;
      color: rgb(113, 118, 123);
      background: transparent;
      border: none;
    `;

    btn.addEventListener('mouseenter', () => {
      btn.style.backgroundColor = 'rgba(29, 155, 240, 0.1)';
      btn.style.color = 'rgb(29, 155, 240)';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.backgroundColor = 'transparent';
      btn.style.color = 'rgb(113, 118, 123)';
    });

    btn.addEventListener('click', handleYinYangClick);

    return btn;
  }

  // 为每条推文注入按钮
  function injectButtons() {
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');
    
    for (const tweet of tweets) {
      if (tweet.querySelector('.' + BUTTON_CLASS)) continue;

      const actionBar = tweet.querySelector('[role="group"]');
      if (!actionBar) continue;

      const replyBtn = actionBar.querySelector('[data-testid="reply"]');
      if (!replyBtn) continue;

      // 找到回复按钮的容器
      const replyContainer = replyBtn.closest('div[class]');
      if (!replyContainer) continue;

      // 创建按钮并插入到回复按钮旁边
      const yinYangBtn = createYinYangButton();
      
      // 存储推文元素的引用
      yinYangBtn._tweetElement = tweet;
      
      // 设置相对定位容器
      if (replyContainer.parentElement) {
        replyContainer.parentElement.style.position = 'relative';
        
        // 将按钮紧贴回复按钮右侧
        yinYangBtn.style.position = 'absolute';
        yinYangBtn.style.left = '40px';
        yinYangBtn.style.top = '50%';
        yinYangBtn.style.transform = 'translateY(-50%)';
        yinYangBtn.style.zIndex = '10';
        
        replyContainer.parentElement.appendChild(yinYangBtn);
      }
    }
  }

  // 防抖
  let debounceTimer = null;
  function debounceInject() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(injectButtons, 500);
  }

  // 监听 DOM 变化
  function setupObserver() {
    const observer = new MutationObserver(debounceInject);
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // 初始化
  function init() {
    setupObserver();
    setTimeout(injectButtons, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
