// 推特阴阳回复助手 - Content Script

(function() {
  'use strict';

  const BUTTON_CLASS = 'yinyang-reply-btn';
  let isGenerating = false;

  // 获取推文内容
  function getTweetContent(tweetElement) {
    const tweetText = tweetElement.querySelector('[data-testid="tweetText"]');
    if (tweetText && tweetText.innerText.trim()) {
      return tweetText.innerText.trim();
    }
    // 如果没有文字，尝试获取图片alt或返回默认提示
    const img = tweetElement.querySelector('img[alt]');
    if (img && img.alt && !img.alt.includes('头像')) {
      return `[图片内容: ${img.alt}]`;
    }
    return null;
  }

  // 生成回复
  async function generateReply(tweetContent) {
    console.log('[阴阳助手] 开始生成回复，推文内容:', tweetContent);
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'generateReply',
        tweetContent: tweetContent
      }, (response) => {
        console.log('[阴阳助手] 收到响应:', response);
        if (chrome.runtime.lastError) {
          console.error('[阴阳助手] 运行时错误:', chrome.runtime.lastError);
          reject(new Error(chrome.runtime.lastError.message || '扩展通信失败，请刷新页面'));
          return;
        }
        if (response && response.success) {
          resolve(response.reply);
        } else {
          reject(new Error(response?.error || '生成失败'));
        }
      });
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
    
    // 使用剪贴板粘贴方式（对 Draft.js 最可靠）
    try {
      // 保存原剪贴板内容
      const originalClipboard = await navigator.clipboard.readText().catch(() => '');
      
      // 写入要粘贴的内容
      await navigator.clipboard.writeText(text);
      console.log('[阴阳助手] 已写入剪贴板');
      
      // 模拟粘贴
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: new DataTransfer()
      });
      pasteEvent.clipboardData.setData('text/plain', text);
      editableElement.dispatchEvent(pasteEvent);
      
      // 也尝试 execCommand paste
      document.execCommand('paste');
      
      // 如果还是没内容，用 insertText
      await new Promise(r => setTimeout(r, 100));
      if (!editableElement.textContent.trim()) {
        console.log('[阴阳助手] 粘贴失败，尝试 insertText');
        document.execCommand('insertText', false, text);
      }
      
      // 恢复原剪贴板
      if (originalClipboard) {
        await navigator.clipboard.writeText(originalClipboard).catch(() => {});
      }
    } catch (e) {
      console.log('[阴阳助手] 剪贴板方式失败，使用备用方案:', e);
      // 备用方案：模拟输入
      document.execCommand('insertText', false, text);
    }
    
    // 触发事件
    editableElement.dispatchEvent(new InputEvent('input', { 
      bubbles: true, 
      composed: true,
      inputType: 'insertText',
      data: text
    }));
    
    // 等待一下让 Draft.js 处理
    await new Promise(r => setTimeout(r, 200));
    
    console.log('[阴阳助手] 填入完成，当前内容:', editableElement.textContent);
  }

  // 点击发送按钮
  function clickSendButton() {
    return new Promise((resolve) => {
      setTimeout(() => {
        const sendBtn = document.querySelector('[data-testid="tweetButton"]') ||
                       document.querySelector('[data-testid="tweetButtonInline"]');
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
          resolve(true);
        } else {
          resolve(false);
        }
      }, 300);
    });
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
    if (!tweetContent) {
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
