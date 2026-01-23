// 推特阴阳回复助手 - Popup Script

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const statusDiv = document.getElementById('status');
  const toggleKeyBtn = document.getElementById('toggleKey');
  const modeRadios = document.querySelectorAll('input[name="mode"]');

  // 加载已保存的设置
  chrome.storage.sync.get(['deepseekApiKey', 'attackMode'], (result) => {
    if (result.deepseekApiKey) {
      apiKeyInput.value = result.deepseekApiKey;
    }
    if (result.attackMode) {
      const radio = document.querySelector(`input[name="mode"][value="${result.attackMode}"]`);
      if (radio) radio.checked = true;
    }
  });

  // 切换密码显示
  toggleKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyBtn.textContent = '隐藏';
    } else {
      apiKeyInput.type = 'password';
      toggleKeyBtn.textContent = '显示';
    }
  });

  // 显示状态消息
  function showStatus(message, isError = false) {
    statusDiv.textContent = message;
    statusDiv.className = 'status ' + (isError ? 'error' : 'success');
    
    setTimeout(() => {
      statusDiv.className = 'status';
    }, 3000);
  }

  // 保存设置
  saveBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const selectedMode = document.querySelector('input[name="mode"]:checked').value;

    if (apiKey && !apiKey.startsWith('sk-')) {
      showStatus('API Key 格式不正确', true);
      return;
    }

    chrome.storage.sync.set({ 
      deepseekApiKey: apiKey,
      attackMode: selectedMode
    }, () => {
      const modeNames = {
        gentle: '善良模式 😇',
        normal: '你先惹的我模式 😏',
        nuclear: '都别活了模式 💀'
      };
      showStatus(`保存成功！当前：${modeNames[selectedMode]}`);
    });
  });

  // 回车保存
  apiKeyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveBtn.click();
    }
  });
});
