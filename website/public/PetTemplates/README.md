# PetTemplates 模板库说明

`PetTemplates/` 是桌面宠物模板库，用来存放未来官网里可选择的动物大类和品种模板。

当前 App 实际运行时读取当前选中的模板和动作文件。现在默认读取：

- `PetTemplates/dog/beagle/template.json`
- `PetTemplates/dog/beagle/parts/`
- `PetTemplates/dog/shared_motion.json`

项目根目录下旧的 `template.json`、`motion.json`、`parts/` 可以作为早期调试文件保留，但后续模板库应优先维护 `PetTemplates/` 里的文件。

## 目录职责

### `shared_motion.json`

`shared_motion.json` 是同一动物大类共用的动作文件。

例如：

- `PetTemplates/dog/shared_motion.json` 给所有狗品种共用。
- `PetTemplates/cat/shared_motion.json` 以后给所有猫品种共用。
- `PetTemplates/bird/shared_motion.json` 以后给所有鸟品种共用。

不同动物大类不要共用 motion，因为狗、猫、鸟的骨架结构和 bone 命名通常不同。

同一动物大类可以共用 motion，前提是所有品种的 `template.json` 使用一致的 bone 名字。例如狗模板都应该统一使用 `body`、`head`、`tail`、`leftfrontLeg`、`rightfrontLeg`、`leftbackLeg`、`rightbackLeg` 等 bone 名称。

### `template.json`

`template.json` 是每个品种自己的拼接规则。

它记录每个 PNG 切件如何贴到骨架上，包括：

- `image`
- `bone`
- `position`
- `pivot`
- `size`
- `scale`
- `rotation`
- `zIndex`

`template.json` 通常不能随便共用，因为不同品种的头、身体、尾巴、腿的位置、大小、初始角度和 pivot 都可能不同。

### `parts/`

`parts/` 是每个品种自己的 PNG 图片切件。

`parts/` 通常不能共用，因为每个品种的外观不同。比如金毛、柴犬、柯基即使都使用狗的动作骨架，身体比例、耳朵形状、尾巴位置和毛色切件也会不一样。

## 当前已有模板

当前已经跑通的第一只狗模板放在：

`PetTemplates/dog/beagle/`

其中只保留：

- `template.json`
- `parts/`

狗类共用动作被复制到了：

`PetTemplates/dog/shared_motion.json`

## 以后新增品种放哪里

新增狗品种时放在：

- 金毛：`PetTemplates/dog/golden/`
- 柴犬：`PetTemplates/dog/shiba/`
- 柯基：`PetTemplates/dog/corgi/`

每个品种目录里都应该包含：

- `template.json`
- `parts/`

新增猫品种时放在：

- 橘猫：`PetTemplates/cat/orange_cat/`
- 布偶猫：`PetTemplates/cat/ragdoll/`

新增鸟品种时放在：

- 鹦鹉：`PetTemplates/bird/parrot/`
- 玄凤鹦鹉：`PetTemplates/bird/cockatiel/`

## 为什么 motion 可以共用

motion 描述的是 bone 怎么动，而不是某张具体图片怎么长。

只要同一动物大类的 bone 命名和骨架语义一致，不同品种就可以复用同一个动作文件。例如狗的 `walk` 动作可以同时驱动金毛、柴犬、柯基，因为它们都可以有 `body`、`head`、`tail` 和四条腿这些 bone。

## 为什么 template 和 parts 通常不能共用

template 决定 PNG 切件怎么拼起来，里面的 position、pivot、size、zIndex 都和具体图片强相关。

parts 是实际外观图片。不同品种即使用同一套 motion，也会有不同的头部、身体、尾巴、腿部切件。

所以推荐规则是：

- 同一动物大类共用 `shared_motion.json`
- 每个品种单独维护自己的 `template.json`
- 每个品种单独维护自己的 `parts/`
