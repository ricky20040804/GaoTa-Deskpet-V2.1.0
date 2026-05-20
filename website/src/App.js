import { useEffect, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import './App.css';

const generationApiUrl = process.env.REACT_APP_GENERATE_API_URL || '/api/generate-pet-package';

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
    price: '¥19.7',
    text: '真实版宠物、卡通版宠物或卡通版人像，并附带网页代码，联系客服，教你如何从0设计你的专属宠物网站。',
  },
  {
    id: 'portrait-package',
    title: '卡通人像包',
    price: '¥19.7',
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

const paymentQrCode = '/payment/wechat-pay.JPG';

const tutorialSteps = [
  {
    title: '如果你遇到了这个问题',
    image: '/查看教程/出现问题.png',
    alt: 'macOS 提示无法打开应用的问题截图',
  },
  {
    title: '第一步打开设置',
    image: '/查看教程/第一步.png',
    alt: '打开系统设置的截图',
  },
  {
    title: '第二步向下滑动找到隐私与安全性',
    image: '/查看教程/第二步.png',
    alt: '在系统设置中找到隐私与安全性的截图',
  },
  {
    title: '第三步在隐私与安全性中向下滑动并选择仍要打开',
    image: '/查看教程/第三步.png',
    alt: '在隐私与安全性中选择仍要打开的截图',
  },
  {
    title: '第四步选择仍要打开',
    image: '/查看教程/第四步.png',
    alt: '确认仍要打开应用的截图',
  },
  {
    title: '第五步然后就成功运行啦',
    image: '/查看教程/第五步.png',
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

  const selectedPlanDetails = generationPlans.find((plan) => plan.id === selectedPlan) || generationPlans[0];
  const selectedStyleDetails = generationStyles.find((style) => style.id === selectedGenerationStyle) || generationStyles[0];

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
    setPetPhoto(file || null);
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
    if (!petPhoto) {
      setGenerationStatus('error');
      setGenerationMessage('请先上传一张宠物照片。');
      return;
    }

    const orderId = `GT${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    setPaymentOrderId(orderId);
    setIsPaymentOpen(true);
    setGenerationStatus('idle');
    setGenerationMessage(`已创建订单 ${orderId}，请扫码付款后点击“我已付款，开始生成”。`);
  };

  const handleGeneratePackage = async () => {
    if (!petPhoto) {
      setGenerationStatus('error');
      setGenerationMessage('请先上传一张宠物照片。');
      return;
    }

    setIsPaymentOpen(false);
    setGenerationStatus('running');
    setGenerationMessage('正在生成首帧和四段绿幕动作视频，通常需要几分钟，请不要关闭页面。');

    try {
      const formData = new FormData();
      formData.append('photo', petPhoto);
      formData.append('style', selectedGenerationStyle);
      formData.append('plan', selectedPlan);
      formData.append('orderId', paymentOrderId);

      const response = await fetch(generationApiUrl, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `生成失败：HTTP ${response.status}`);
      }

      const blob = await response.blob();
      downloadBlob(blob, 'custompet.zip');
      setGenerationStatus('success');
      setGenerationMessage('生成完成，custompet.zip 已开始下载。解压到“下载”文件夹后，运行器会自动读取 mp4 并实时扣绿播放。');
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
          <a href="#home">Home</a>
          <a href="#download">Download</a>
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
            </div>
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
              {generationMessage || '生成后的 custompet.zip 解压到“下载”文件夹后，桌面运行器会自动读取 mp4 并实时扣绿播放。'}
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
                    onClick={() => setSelectedPlan(plan.id)}
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

                <img className="payment-qr" src={paymentQrCode} alt="微信收款码" />
                <p className="payment-hint">付款时建议备注订单号后 4 位：{paymentOrderId.slice(-4)}</p>

                <button
                  className="payment-confirm-button"
                  disabled={generationStatus === 'running'}
                  onClick={handleGeneratePackage}
                  type="button"
                >
                  我已付款，开始生成
                </button>
                <p className="payment-manual-note">
                  当前为人工收款确认版。请确认完成付款后再开始生成，后续可替换成微信支付自动回调。
                </p>
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
