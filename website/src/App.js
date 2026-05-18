import { useEffect, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import './App.css';

const generationApiUrl = process.env.REACT_APP_GENERATE_API_URL || '/api/generate-pet-package';

const generationStyles = [
  {
    id: 'cartoon-pet',
    title: '卡通版宠物',
    text: '适合生成可爱的桌面伙伴和贴纸感动画。',
    videoWebm: '/卡通宠物.webm',
    videoMov: '/卡通宠物.mov',
  },
  {
    id: 'real-pet',
    title: '真实版宠物',
    text: '尽量保留原宠物照片里的细节和神态。',
    videoWebm: '/真实宠物.webm',
    videoMov: '/真实宠物.mov',
  },
  {
    id: 'cartoon-portrait',
    title: '卡通版人像',
    text: '把照片生成拟人化、头像风格的桌面伙伴。',
    videoWebm: '/卡通人物.webm',
    videoMov: '/卡通人物.mov',
  },
];

const generationPlans = [
  {
    title: '卡通基础包',
    price: '¥9.9',
    text: '卡通版宠物或卡通版人像。',
  },
  {
    title: '真实宠物包',
    price: '¥19.7',
    text: '真实版宠物生成资源包。',
    isRecommended: true,
  },
  {
    title: '完整源码包',
    price: '¥--',
    text: '真实版宠物、卡通版宠物或卡通版人像，加源代码与思路讲解。',
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

function App() {
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [isRunnerDownloadOpen, setIsRunnerDownloadOpen] = useState(false);
  const [selectedGenerationStyle, setSelectedGenerationStyle] = useState(generationStyles[0].id);
  const [petPhoto, setPetPhoto] = useState(null);
  const [petPhotoPreview, setPetPhotoPreview] = useState('');
  const [generationStatus, setGenerationStatus] = useState('idle');
  const [generationMessage, setGenerationMessage] = useState('');

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

  const handleGeneratePackage = async () => {
    if (!petPhoto) {
      setGenerationStatus('error');
      setGenerationMessage('请先上传一张宠物照片。');
      return;
    }

    setGenerationStatus('running');
    setGenerationMessage('正在生成首帧和四段绿幕动作视频，通常需要几分钟，请不要关闭页面。');

    try {
      const formData = new FormData();
      formData.append('photo', petPhoto);
      formData.append('style', selectedGenerationStyle);

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

  return (
    <div className="site-shell">
      <nav className="navbar" aria-label="Primary navigation">
        <a className="brand" href="#home" aria-label="AI Desktop Pet home">
          <img className="brand-mark" src="/logo192.png" alt="" />
          AI Desktop Pet
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
            <h1>Your AI Desktop Pet Companion</h1>
            <p className="hero-subtitle">
              A cute desktop companion that can chat, react, and stay with you while you work.
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
                <span className="hero-action-title">查看教程</span>
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
                    >
                      <source src={style.videoWebm} type="video/webm" />
                      <source src={style.videoMov} type='video/quicktime; codecs="hvc1"' />
                    </video>
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
              onClick={handleGeneratePackage}
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
            <p>选择你需要的宠物生成类型，付费页面后续再接入。</p>
          </div>

          <div className="generation-plan-grid">
            {generationPlans.map((plan) => (
              <article className={`generation-plan-card${plan.isRecommended ? ' is-recommended' : ''}`} key={plan.title}>
                {plan.isRecommended && <span className="recommended-badge">推荐</span>}
                <h3>{plan.title}</h3>
                <p className="plan-price">{plan.price}</p>
                <p>{plan.text}</p>
                <button className={plan.isRecommended ? 'button button-primary' : 'button button-secondary'} type="button">
                  暂未开放
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
              <h2>创建你的专属桌面宠物</h2>
              <p>
                先下载运行器，再选择生成风格并导出
                <strong> custompet.zip </strong>
                宠物数据包；运行器 App 会读取这个数据包并把宠物显示在桌面上。
              </p>
            </div>

            <div className="tutorial-grid">
              <article className="tutorial-card tutorial-card-primary">
                <img
                  className="tutorial-visual"
                  src="/tutorial/cartoon-builder.svg"
                  alt="Cartoon pet builder showing drawing canvas, part picker, and save flow"
                />
                <span className="tutorial-step">01</span>
                <h3>上传照片</h3>
                <ol>
                  <li>在“创建你的桌面宠物”区域上传宠物照片。</li>
                  <li>选择卡通版宠物、真实版宠物或卡通版人像。</li>
                  <li>点击生成宠物资源包。</li>
                </ol>
              </article>

              <article className="tutorial-card">
                <img
                  className="tutorial-visual"
                  src="/tutorial/start-creating.svg"
                  alt="Start creating flow from homepage to custom pet export"
                />
                <span className="tutorial-step">02</span>
                <h3>导入运行器</h3>
                <ol>
                  <li>下载 macOS 或 Windows 运行器。</li>
                  <li>把生成的 custompet.zip 放在“下载”文件夹里解压。</li>
                  <li>确认出现 Downloads/custompet 文件夹，再打开运行器。</li>
                </ol>
              </article>
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
        <span>AI Desktop Pet</span>
        <span>Copyright 2026 AI Desktop Pet. All rights reserved.</span>
      </footer>
    </div>
  );
}

export default App;
