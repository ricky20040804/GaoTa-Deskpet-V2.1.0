import { useCallback, useEffect, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import './App.css';

const defaultGenerationApiUrl = 'https://api.gaotadeskpet.cn/api/generate-pet-package';
const configuredGenerationApiUrl = process.env.REACT_APP_GENERATE_API_URL || defaultGenerationApiUrl;
const configuredApiOriginMatch = configuredGenerationApiUrl.match(/^https?:\/\/[^/]+/i);
const generationApiUrl = configuredApiOriginMatch ? configuredGenerationApiUrl : defaultGenerationApiUrl;
const apiOriginMatch = generationApiUrl.match(/^https?:\/\/[^/]+/i);
const apiOrigin = apiOriginMatch ? apiOriginMatch[0] : '';
const buildApiUrl = (path) => (apiOrigin ? `${apiOrigin}${path}` : path);
const authTokenStorageKey = 'gaota_auth_token';
const deviceIdStorageKey = 'gaota_device_id';
const maxUploadBytes = 15 * 1024 * 1024;
const allowedUploadTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

const getDeviceId = () => {
  let deviceId = window.localStorage.getItem(deviceIdStorageKey);
  if (deviceId) {
    return deviceId;
  }

  if (window.crypto?.randomUUID) {
    deviceId = window.crypto.randomUUID();
  } else {
    deviceId = `gaota-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  }
  window.localStorage.setItem(deviceIdStorageKey, deviceId);
  return deviceId;
};

const readApiResponse = async (response) => {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const generationStyles = [
  {
    id: 'cartoon-pet',
    title: '卡通版宠物',
    text: '适合生成可爱的桌面伙伴和贴纸感动画。',
    video: '/卡通宠物.mp4',
  },
  {
    id: 'real-pet',
    title: '真实版宠物',
    text: '尽量保留原宠物照片里的细节和神态。',
    video: '/真实宠物.mp4',
  },
  {
    id: 'cartoon-portrait',
    title: '卡通版人像',
    text: '把照片生成拟人化、头像风格的桌面伙伴。',
    video: '/卡通人物.mp4',
  },
];

const generationPlans = [
  {
    id: 'pet-package',
    title: '专属宠物包',
    price: '¥9.9',
    text: '卡通版宠物或真实版宠物资源包。',
    isRecommended: true,
  },
  {
    id: 'complete-package',
    title: '全套完整包',
    price: '¥19.9',
    text: '真实版宠物、卡通版宠物或卡通版人像，附带app源代码。',
  },
  {
    id: 'portrait-package',
    title: '卡通人像包',
    price: '¥12.9',
    text: '卡通版人像生成资源包。',
  },
];

const generationProgressMessages = [
  '正在上传照片并提交生成任务...',
  '正在生成宠物首帧...',
  '正在生成 idle 待机动作...',
  '正在生成 run 奔跑动作...',
  '正在生成 happy 开心动作...',
  '正在生成 rest 趴着动作...',
  '正在检查绿幕背景是否稳定...',
  '正在打包 custompet.zip...'
];

const paymentQrCodes = {
  'pet-package': '/payment/9.9.JPG',
  'complete-package': '/payment/19.9.JPG',
  'portrait-package': '/payment/12.9.JPG',
};

const tutorialSteps = [
  {
    title: '如果你遇到了这个问题',
    image: '/查看教程/出现问题.jpg',
    alt: 'macOS 提示无法打开应用的问题截图',
  },
  {
    title: '第一步打开设置',
    image: '/查看教程/第一步.jpg',
    alt: '打开系统设置的截图',
  },
  {
    title: '第二步向下滑动找到隐私与安全性',
    image: '/查看教程/第二步.jpg',
    alt: '在系统设置中找到隐私与安全性的截图',
  },
  {
    title: '第三步在隐私与安全性中向下滑动并选择仍要打开',
    image: '/查看教程/第三步.jpg',
    alt: '在隐私与安全性中选择仍要打开的截图',
  },
  {
    title: '第四步选择仍要打开',
    image: '/查看教程/第四步.jpg',
    alt: '确认仍要打开应用的截图',
  },
  {
    title: '第五步然后就成功运行啦',
    image: '/查看教程/第五步.jpg',
    alt: '桌面宠物成功运行的截图',
  },
];

function App() {
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [isRunnerDownloadOpen, setIsRunnerDownloadOpen] = useState(false);
  const [selectedGenerationStyle, setSelectedGenerationStyle] = useState(generationStyles[0].id);
  const [selectedPlan, setSelectedPlan] = useState(generationPlans[0].id);
  const [petPhoto, setPetPhoto] = useState(null);
  const [petPhotoPreview, setPetPhotoPreview] = useState('');
  const [generationStatus, setGenerationStatus] = useState('idle');
  const [generationMessage, setGenerationMessage] = useState('');
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [paymentOrderId, setPaymentOrderId] = useState('');
  const [isPaymentConfirmReady, setIsPaymentConfirmReady] = useState(false);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [authToken, setAuthToken] = useState(() => window.localStorage.getItem(authTokenStorageKey) || '');
  const [currentUser, setCurrentUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginMessage, setLoginMessage] = useState('');
  const [loginStatus, setLoginStatus] = useState('idle');

  const selectedPlanDetails = generationPlans.find((plan) => plan.id === selectedPlan) || generationPlans[0];
  const selectedStyleDetails = generationStyles.find((style) => style.id === selectedGenerationStyle) || generationStyles[0];
  const selectedPaymentQrCode = paymentQrCodes[selectedPlan] || paymentQrCodes['pet-package'];

  useEffect(() => {
    if (!petPhoto) {
      setPetPhotoPreview('');
      return undefined;
    }

    const previewUrl = URL.createObjectURL(petPhoto);
    setPetPhotoPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [petPhoto]);

  useEffect(() => {
    const playPreviewVideos = () => {
      document.querySelectorAll('video[data-preview-video="true"]').forEach((video) => {
        video.muted = true;
        video.play().catch(() => {});
      });
    };

    playPreviewVideos();
    document.addEventListener('visibilitychange', playPreviewVideos);
    return () => document.removeEventListener('visibilitychange', playPreviewVideos);
  }, []);

  useEffect(() => {
    tutorialSteps.forEach((step) => {
      const image = new Image();
      image.src = step.image;
    });
  }, []);

  useEffect(() => {
    if (!isPaymentOpen) {
      setIsPaymentConfirmReady(false);
      return undefined;
    }

    setIsPaymentConfirmReady(false);
    const timer = window.setTimeout(() => {
      setIsPaymentConfirmReady(true);
    }, 15000);
    return () => window.clearTimeout(timer);
  }, [isPaymentOpen, paymentOrderId]);

  const authHeaders = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  const refreshCurrentUser = useCallback(async (token = authToken) => {
    if (!token) {
      setCurrentUser(null);
      return null;
    }

    try {
      const response = await fetch(buildApiUrl('/api/auth/me'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await readApiResponse(response);
      if (data.authenticated) {
        setCurrentUser(data.user);
        return data.user;
      }
      window.localStorage.removeItem(authTokenStorageKey);
      setAuthToken('');
      setCurrentUser(null);
      return null;
    } catch {
      return null;
    }
  }, [authToken]);

  useEffect(() => {
    refreshCurrentUser();
  }, [refreshCurrentUser]);

  const openLogin = () => {
    setIsLoginOpen(true);
    setLoginMessage(currentUser ? `已登录：${currentUser.username}` : '');
  };

  const validateAccountForm = ({ needsUsername = false } = {}) => {
    const phone = loginPhone.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setLoginStatus('error');
      setLoginMessage('请输入正确的中国大陆手机号。');
      return null;
    }
    const password = loginPassword;
    if (password.length < 6 || password.length > 64) {
      setLoginStatus('error');
      setLoginMessage('密码需要 6 到 64 个字符。');
      return null;
    }
    const username = loginUsername.trim();
    if (needsUsername && (username.length < 2 || username.length > 20)) {
      setLoginStatus('error');
      setLoginMessage('用户名需要 2 到 20 个字符。');
      return null;
    }
    return { phone, password, username };
  };

  const handleRegister = async () => {
    const account = validateAccountForm({ needsUsername: true });
    if (!account) {
      return;
    }

    setLoginStatus('registering');
    setLoginMessage('正在注册...');
    try {
      const response = await fetch(buildApiUrl('/api/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...account, deviceId: getDeviceId() }),
      });
      const data = await readApiResponse(response);
      if (!response.ok || !data.ok) {
        throw new Error(data.message || '注册失败。');
      }
      window.localStorage.setItem(authTokenStorageKey, data.token);
      setAuthToken(data.token);
      setCurrentUser(data.user);
      setIsLoginOpen(false);
      setLoginPassword('');
      setLoginStatus('idle');
      setGenerationMessage(`注册成功：${data.user.username}，当前账号最多可付费生成 ${data.user.generationLimit} 次。`);
    } catch (error) {
      setLoginStatus('error');
      setLoginMessage(error.message || '注册失败。');
    }
  };

  const handleLogin = async () => {
    const account = validateAccountForm();
    if (!account) {
      return;
    }

    setLoginStatus('logging-in');
    setLoginMessage('正在登录...');
    try {
      const response = await fetch(buildApiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: account.phone, password: account.password }),
      });
      const data = await readApiResponse(response);
      if (!response.ok || !data.ok) {
        throw new Error(data.message || '登录失败。');
      }
      window.localStorage.setItem(authTokenStorageKey, data.token);
      setAuthToken(data.token);
      setCurrentUser(data.user);
      setIsLoginOpen(false);
      setLoginPassword('');
      setLoginStatus('idle');
      setGenerationMessage(`已登录：${data.user.username}，剩余付费生成次数 ${data.user.remainingGenerations}/${data.user.generationLimit}。`);
    } catch (error) {
      setLoginStatus('error');
      setLoginMessage(error.message || '登录失败。');
    }
  };

  const handleLogout = async () => {
    try {
      if (authToken) {
        await fetch(buildApiUrl('/api/auth/logout'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
      }
    } catch {
      // Local logout still succeeds if the network is unavailable.
    }
    window.localStorage.removeItem(authTokenStorageKey);
    setAuthToken('');
    setCurrentUser(null);
    setIsLoginOpen(false);
    setGenerationMessage('已退出登录。');
  };

  useEffect(() => {
    if (generationStatus !== 'running') {
      return undefined;
    }

    const startedAt = Date.now();
    const updateProgressMessage = () => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      const stepIndex = Math.min(
        generationProgressMessages.length - 1,
        Math.floor(elapsedSeconds / 35)
      );
      setGenerationMessage(`${generationProgressMessages[stepIndex]} 已等待约 ${elapsedSeconds} 秒，请不要关闭页面。`);
    };

    updateProgressMessage();
    const timer = window.setInterval(updateProgressMessage, 1000);
    return () => window.clearInterval(timer);
  }, [generationStatus]);

  const formatGenerationError = (error) => {
    const message = error?.message || '';
    const text = message
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) {
      return '生成失败，请稍后重新生成。';
    }
    if (text.includes('视频背景检查失败')) {
      return text;
    }
    if (text.includes('Failed to fetch')) {
      return `生成接口暂时连接不上，请稍后再试。`;
    }
    return text;
  };

  const handlePetPhotoChange = (event) => {
    const file = event.target.files?.[0];
    if (file && !allowedUploadTypes.has(file.type)) {
      event.target.value = '';
      setPetPhoto(null);
      setGenerationStatus('error');
      setGenerationMessage('请上传 PNG、JPG 或 WEBP 格式的图片。');
      return;
    }
    if (file && file.size > maxUploadBytes) {
      event.target.value = '';
      setPetPhoto(null);
      setGenerationStatus('error');
      setGenerationMessage('图片文件太大，请上传 15MB 以内的图片。');
      return;
    }
    setPetPhoto(file || null);
    setGenerationStatus('idle');
    setGenerationMessage(file ? `已选择：${file.name}` : '');
  };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const createPaymentOrder = () => {
    if (!currentUser) {
      setGenerationStatus('error');
      setGenerationMessage('请先登录账号后再生成宠物资源包。');
      openLogin();
      return;
    }
    if (currentUser.remainingGenerations <= 0) {
      setGenerationStatus('error');
      setGenerationMessage('当前账号的生成次数已经用完。');
      return;
    }
    if (!petPhoto) {
      setGenerationStatus('error');
      setGenerationMessage('请先上传一张宠物照片。');
      return;
    }

    const orderId = `GT${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    setPaymentOrderId(orderId);
    setIsPaymentOpen(true);
    setGenerationStatus('idle');
    setGenerationMessage(`已创建订单 ${orderId}，请扫码付款后等待订单查询完成。`);
  };

  const handlePaymentPlanSelect = (planId) => {
    setSelectedPlan(planId);
    if (planId === 'portrait-package') {
      setSelectedGenerationStyle('cartoon-portrait');
      return;
    }
    if (planId === 'pet-package' && selectedGenerationStyle === 'cartoon-portrait') {
      setSelectedGenerationStyle('cartoon-pet');
    }
  };

  const handleGeneratePackage = async () => {
    if (!isPaymentConfirmReady) {
      return;
    }
    if (!authToken || !currentUser) {
      setGenerationStatus('error');
      setGenerationMessage('请先登录账号后再生成宠物资源包。');
      openLogin();
      return;
    }
    if (!petPhoto) {
      setGenerationStatus('error');
      setGenerationMessage('请先上传一张宠物照片。');
      return;
    }

    setIsPaymentOpen(false);
    setGenerationStatus('running');
    setGenerationMessage('正在生成宠物包，通常需要几分钟，请不要关闭页面。');

    try {
      const formData = new FormData();
      formData.append('photo', petPhoto);
      formData.append('style', selectedGenerationStyle);
      formData.append('plan', selectedPlan);
      formData.append('orderId', paymentOrderId);

      const response = await fetch(generationApiUrl, {
        method: 'POST',
        headers: authHeaders,
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `生成失败：HTTP ${response.status}`);
      }

      const blob = await response.blob();
      downloadBlob(blob, 'custompet.zip');
      setGenerationStatus('success');
      setGenerationMessage('生成完成，custompet.zip 已开始下载。请您务必解压到“下载”文件夹，这样运行器才能成功读取。');
      refreshCurrentUser();
    } catch (error) {
      setGenerationStatus('error');
      setGenerationMessage(formatGenerationError(error));
    }
  };

  const handlePlanAction = (planId) => {
    setSelectedPlan(planId);
    document.getElementById('create-pet')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="site-shell">
      <nav className="navbar" aria-label="Primary navigation">
        <a className="brand" href="#home" aria-label="GaoTa Desktop Pet home">
          <img className="brand-mark" src="/logo192.png" alt="" />
          GaoTa Desktop Pet
        </a>
        <div className="nav-links">
          <a href="#home">首页</a>
          <a href="#download">下载</a>
          <button className="nav-login-button" onClick={openLogin} type="button">
            {currentUser ? currentUser.username : '登录'}
          </button>
        </div>
      </nav>

      <main>
        <section className="hero section-grid" id="home">
          <div className="hero-copy">
            <p className="eyebrow">AI companion for macOS</p>
            <h1>高塔AI
                桌面宠物伙伴<br />
                正式上线！</h1>
            <p className="hero-subtitle">
              不管你的宠物现在在哪里，都可以在你的电脑桌面上陪着你啦！<br />
              支持Claudecode，Codex，Copilot，Gemini，OpenClaw，豆包等多种ai介入，让你的桌面宠物成为你的有温度的精神伴侣！<br />
              还在觉得常规桌面宠物卡顿，耗费token，部署困难吗，更加便利的桌面宠物来啦！只需要导入一张图片，就能生成独属于你家的专属宠物哟！
            </p>
          </div>

          <div className="product-showcase" aria-label="AI Desktop Pet product preview">
            <div className="showcase-frame">
              <video
                aria-label="AI Desktop Pet app preview with a cute desktop companion"
                autoPlay
                data-preview-video="true"
                loop
                muted
                playsInline
                preload="auto"
                src="/cover.mp4?v=20260518222023"
              />
            </div>
            <div className="floating-note note-chat">
              <span>Chat ready</span>
              <strong>Always nearby</strong>
            </div>
            <div className="floating-note note-mood">
              <span>Mood</span>
              <strong>Happy</strong>
            </div>
          </div>

          <div className="hero-actions">
            <a className="button button-primary" href="#download">
              <span className="hero-action-title">开始制作</span>
              <span className="hero-action-subtitle">Start Creating</span>
            </a>
            <button
              className="button button-secondary"
              onClick={() => setIsTutorialOpen(true)}
              type="button"
            >
              <span className="hero-action-title">下载问题-查看教程</span>
              <span className="hero-action-subtitle">View Tutorial</span>
            </button>
            <button className="button button-secondary" onClick={openLogin} type="button">
              <span className="hero-action-title">记得先登录哟</span>
              <span className="hero-action-subtitle">
                {currentUser ? `剩余 ${currentUser.remainingGenerations}/${currentUser.generationLimit}` : 'Login First'}
              </span>
            </button>
          </div>
        </section>

        <section className="download-section section-grid" id="download">
          <div className="download-intro">
            <p className="eyebrow">Download</p>
            <h2>运行你的专属桌面宠物</h2>
            <p>
              这里分成两个下载：macOS 运行器负责启动桌面宠物，网页里生成的
              <strong> custompet.zip </strong>
              负责提供你的宠物外观数据。
            </p>
          </div>

          <div className="download-flow" aria-label="Desktop pet running steps">
            <article className="download-step-card">
              <span className="download-step-index">01</span>
              <h3>下载 App 运行器</h3>
              <p>这是桌面宠物 App 本体。下载后解压，首次打开如果被 macOS 拦截，请右键选择打开。</p>
              <button className="button button-primary" onClick={() => setIsRunnerDownloadOpen(true)} type="button">
                下载运行器
              </button>
            </article>

            <article className="download-step-card">
              <span className="download-step-index">02</span>
              <h3>制作宠物数据包</h3>
              <p>回到制作区上传照片，点击生成宠物资源包下载 custompet.zip。</p>
              <a className="button button-secondary" href="#create-pet">
                开始制作
              </a>
            </article>

            <article className="download-step-card">
              <span className="download-step-index">03</span>
              <h3>放置并运行</h3>
              <p>把 custompet.zip 放在“下载”文件夹里解压，得到 Downloads/custompet，然后重新打开运行器。</p>
              <button className="button button-secondary" onClick={() => setIsTutorialOpen(true)} type="button">
                查看教程
              </button>
            </article>
          </div>
        </section>

        <section className="pet-generator-section" id="create-pet">
          <div className="generator-upload-panel">
            <h2>创建你的桌面宠物</h2>
            <p>把宠物照片拖到这里，然后选择你想要的生成风格。</p>

            <input
              accept="image/png,image/jpeg,image/webp"
              aria-label="上传宠物照片"
              className="pet-upload-input"
              id="pet-photo-input"
              onChange={handlePetPhotoChange}
              type="file"
            />
            <label className={`pet-upload-dropzone${petPhotoPreview ? ' has-preview' : ''}`} htmlFor="pet-photo-input">
              {petPhotoPreview ? (
                <img alt="用户上传的宠物照片预览" className="pet-photo-preview" src={petPhotoPreview} />
              ) : (
                <>
                  <span className="upload-circle">
                    <ImagePlus size={34} strokeWidth={1.8} />
                  </span>
                  <strong>把宠物照片拖到这里，或点击选择文件</strong>
                  <span>支持 PNG、JPG、WEBP，清晰全身照效果更好</span>
                </>
              )}
            </label>

            {petPhoto ? (
              <label className="reupload-photo-button" htmlFor="pet-photo-input">
                重新上传照片
              </label>
            ) : (
              <p className="upload-empty-state">还没有上传照片</p>
            )}
          </div>

          <div className="generator-style-panel">
            <p className="section-label">选择生成风格</p>
            <div className="generation-style-grid">
              {generationStyles.map((style) => (
                <button
                  aria-pressed={selectedGenerationStyle === style.id}
                  className={`generation-style-card${selectedGenerationStyle === style.id ? ' is-selected' : ''}`}
                  key={style.title}
                  onClick={() => setSelectedGenerationStyle(style.id)}
                  type="button"
                >
                  <span className="style-image-frame">
                    <video
                      aria-label={`${style.title}示例`}
                      autoPlay
                      data-preview-video="true"
                      loop
                      muted
                      playsInline
                      preload="auto"
                      src={style.video}
                    />
                  </span>
                  <strong>{style.title}</strong>
                  <span>{style.text}</span>
                  {selectedGenerationStyle === style.id && <span className="style-check">✓</span>}
                </button>
              ))}
            </div>

            <button
              className="generate-package-button"
              disabled={generationStatus === 'running'}
              onClick={createPaymentOrder}
              type="button"
            >
              {generationStatus === 'running' ? '正在生成资源包' : '生成宠物资源包'}
              <span aria-hidden="true">→</span>
            </button>
            <p className={`generator-note generator-note-${generationStatus}`}>
              {generationMessage || (currentUser
                ? `当前账号剩余付费生成次数：${currentUser.remainingGenerations}/${currentUser.generationLimit}。生成后的 custompet.zip 请您务必解压到“下载”文件夹，这样运行器才能成功读取。`
                : '请先登录账号。生成后的 custompet.zip 解压到“下载”文件夹后，桌面运行器会自动读取 mp4 并实时扣绿播放。')}
            </p>
          </div>
        </section>

        <section className="generation-plan-section" id="pricing">
          <div className="plan-copy">
            <h2>选择生成方案</h2>
            <p>选择你需要的宠物生成类型，上传照片后付款即可开始生成。</p>
          </div>

          <div className="generation-plan-grid">
            {generationPlans.map((plan) => (
              <article
                className={`generation-plan-card${plan.isRecommended ? ' is-recommended' : ''}${selectedPlan === plan.id ? ' is-selected' : ''}`}
                key={plan.id}
                onClick={() => setSelectedPlan(plan.id)}
              >
                {plan.isRecommended && <span className="recommended-badge">推荐</span>}
                <h3>{plan.title}</h3>
                <p className="plan-price">{plan.price}</p>
                <p>{plan.text}</p>
                <button
                  className="button button-secondary plan-action-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handlePlanAction(plan.id);
                  }}
                  type="button"
                >
                  选择这个方案
                </button>
              </article>
            ))}
          </div>
        </section>
      </main>

      {isTutorialOpen && (
        <div className="tutorial-overlay" role="presentation" onMouseDown={() => setIsTutorialOpen(false)}>
          <section
            aria-label="Create your desktop pet tutorial"
            aria-modal="true"
            className="tutorial-modal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <button
              aria-label="Close tutorial"
              className="tutorial-close-button"
              onClick={() => setIsTutorialOpen(false)}
              type="button"
            >
              <X size={22} strokeWidth={2.4} />
            </button>

            <div className="tutorial-intro">
              <p className="eyebrow">Tutorial</p>
              <h2>下载问题-查看教程</h2>
            </div>

            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <article className="tutorial-card" key={step.title}>
                  <span className="tutorial-step">{String(index + 1).padStart(2, '0')}</span>
                  <h3>{step.title}</h3>
                  <img className="tutorial-visual" src={step.image} alt={step.alt} />
                </article>
              ))}
            </div>
          </section>
        </div>
      )}

      {isLoginOpen && (
        <div className="login-overlay" role="presentation" onMouseDown={() => setIsLoginOpen(false)}>
          <section
            aria-label="账号登录"
            aria-modal="true"
            className="login-modal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <button
              aria-label="关闭登录窗口"
              className="login-close"
              onClick={() => setIsLoginOpen(false)}
              type="button"
            >
              <X size={20} strokeWidth={2.4} />
            </button>

            <p className="eyebrow">Login</p>
            <h2>账号登录</h2>
            <p className="login-copy">每个账号最多可付费生成 3 次宠物资源包。</p>

            {currentUser ? (
              <div className="login-account-card">
                <span>当前已登录</span>
                <strong>{currentUser.username}</strong>
                <span>{currentUser.maskedPhone}</span>
                <span>剩余付费生成次数：{currentUser.remainingGenerations}/{currentUser.generationLimit}</span>
                <button className="button button-secondary" onClick={handleLogout} type="button">
                  退出登录
                </button>
              </div>
            ) : (
              <div className="login-form">
                <div className="login-mode-tabs" role="tablist" aria-label="账号操作">
                  <button
                    aria-selected={authMode === 'login'}
                    className={authMode === 'login' ? 'is-active' : ''}
                    onClick={() => {
                      setAuthMode('login');
                      setLoginMessage('');
                    }}
                    role="tab"
                    type="button"
                  >
                    登录
                  </button>
                  <button
                    aria-selected={authMode === 'register'}
                    className={authMode === 'register' ? 'is-active' : ''}
                    onClick={() => {
                      setAuthMode('register');
                      setLoginMessage('');
                    }}
                    role="tab"
                    type="button"
                  >
                    注册
                  </button>
                </div>
                {authMode === 'register' && (
                  <label>
                    <span>用户名</span>
                    <input
                      maxLength={20}
                      onChange={(event) => setLoginUsername(event.target.value.slice(0, 20))}
                      placeholder="请输入 2 到 20 位用户名"
                      type="text"
                      value={loginUsername}
                    />
                  </label>
                )}
                <label>
                  <span>中国大陆手机号</span>
                  <input
                    inputMode="numeric"
                    maxLength={11}
                    onChange={(event) => setLoginPhone(event.target.value.replace(/\D/g, '').slice(0, 11))}
                    placeholder="请输入 11 位手机号"
                    type="tel"
                    value={loginPhone}
                  />
                </label>
                <label>
                  <span>密码</span>
                  <input
                    autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                    maxLength={64}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    placeholder="请输入 6 到 64 位密码"
                    type="password"
                    value={loginPassword}
                  />
                </label>
                <button
                  className="login-submit-button"
                  disabled={loginStatus === 'logging-in' || loginStatus === 'registering'}
                  onClick={authMode === 'register' ? handleRegister : handleLogin}
                  type="button"
                >
                  {loginStatus === 'logging-in' && '登录中'}
                  {loginStatus === 'registering' && '注册中'}
                  {loginStatus !== 'logging-in' && loginStatus !== 'registering' && (authMode === 'register' ? '注册并登录' : '登录')}
                </button>
              </div>
            )}

            <p className={`login-message login-message-${loginStatus}`}>
              {loginMessage || '注册后请先付款，再生成宠物资源包；每个账号最多可付费生成 3 次。'}
            </p>
          </section>
        </div>
      )}

      {isPaymentOpen && (
        <div className="payment-overlay" role="presentation" onMouseDown={() => setIsPaymentOpen(false)}>
          <section
            aria-label="确认付款并生成宠物资源包"
            aria-modal="true"
            className="payment-modal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <button
              aria-label="关闭付款窗口"
              className="payment-close"
              onClick={() => setIsPaymentOpen(false)}
              type="button"
            >
              <X size={20} strokeWidth={2.4} />
            </button>

            <div className="payment-intro">
              <p className="eyebrow">Payment</p>
              <h2>确认生成方案</h2>
              <p>请核对方案和金额，使用微信扫码付款后点击按钮开始生成资源包。</p>
            </div>

            <div className="payment-layout">
              <div className="payment-plan-list" aria-label="选择生成方案">
                {generationPlans.map((plan) => (
                  <button
                    aria-pressed={selectedPlan === plan.id}
                    className={`payment-plan-option${selectedPlan === plan.id ? ' is-selected' : ''}`}
                    key={plan.id}
                    onClick={() => handlePaymentPlanSelect(plan.id)}
                    type="button"
                  >
                    <span>
                      <strong>{plan.title}</strong>
                      <small>{plan.text}</small>
                    </span>
                    <b>{plan.price}</b>
                  </button>
                ))}
              </div>

              <div className="payment-card">
                <div className="payment-summary">
                  <span>订单号</span>
                  <strong>{paymentOrderId}</strong>
                </div>
                <div className="payment-summary">
                  <span>生成风格</span>
                  <strong>{selectedStyleDetails.title}</strong>
                </div>
                <div className="payment-summary">
                  <span>应付金额</span>
                  <strong>{selectedPlanDetails.price}</strong>
                </div>

                <img className="payment-qr" src={selectedPaymentQrCode} alt="微信收款码" />
                <p className="payment-hint">付款时建议备注订单号后 4 位：{paymentOrderId.slice(-4)}</p>

                {isPaymentConfirmReady ? (
                  <button
                    className="payment-confirm-button"
                    disabled={generationStatus === 'running'}
                    onClick={handleGeneratePackage}
                    type="button"
                  >
                    我已付款，开始生成
                  </button>
                ) : (
                  <p className="payment-query-status">请您支付，正在查询订单中</p>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {isRunnerDownloadOpen && (
        <div className="runner-download-overlay" role="presentation" onMouseDown={() => setIsRunnerDownloadOpen(false)}>
          <section
            aria-label="选择运行器下载版本"
            aria-modal="true"
            className="runner-download-modal"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <button
              aria-label="关闭下载选项"
              className="runner-download-close"
              onClick={() => setIsRunnerDownloadOpen(false)}
              type="button"
            >
              <X size={20} strokeWidth={2.4} />
            </button>

            <p className="eyebrow">Download Runner</p>
            <h2>选择运行器版本</h2>
            <p>先下载 App 运行器，再把生成的宠物资源包放到“下载”文件夹播放。</p>

            <div className="runner-download-options">
              <a className="runner-download-option" href="/downloads/gaotadeskpet.zip" download>
                <strong>下载 macOS</strong>
                <span>适用于 Mac 桌面宠物运行器</span>
              </a>
              <a className="runner-download-option" href="/downloads/gaotadeskpet-windows.zip" download>
                <strong>下载 Windows</strong>
                <span>适用于 Windows 桌面宠物运行器</span>
              </a>
            </div>
          </section>
        </div>
      )}

      <footer className="footer">
        <span>GaoTa Desktop Pet</span>
        <span>Copyright 2026 GaoTa Desktop Pet. All rights reserved.</span>
      </footer>
    </div>
  );
}

export default App;
