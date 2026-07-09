/*
=============================
★★★ Supabase 云端同步配置区 ★★★
本区域负责：初始化客户端 → 拉取云端全量数据 → 云端增/改/删
=============================
*/
const SUPABASE_URL = 'https://ofeiflviqyhidvgjookl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_2B9ExLqgbOtGXxuNd2LSXg_B5DFlpFg';
let supabaseClient = null;
let isSupabaseReady = false;

/**
 * 初始化Supabase客户端（依赖index.html引入的supabase-js CDN）
 */
function initSupabase() {
    try {
        if (typeof supabase === 'undefined') {
            console.error('[Supabase] supabase-js SDK未加载，请检查CDN引入');
            return;
        }
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        isSupabaseReady = true;
        console.log('[Supabase] 客户端初始化成功');
    } catch (e) {
        console.error('[Supabase] 初始化失败:', e.message);
        showToast('云端数据库连接失败，请刷新页面重试', 'error');
    }
}

/* ---------- 驼峰 ↔ 下划线 字段名转换工具 ---------- */
/**
 * 基础信息：前端驼峰 → 数据库下划线
 * avgPrice→avg_price  openingPeriod→opening_period  createdAt→created_at
 */
function basicToSnakeCase(record) {
    return {
        name: record.name, address: record.address, owner: record.owner,
        phone: record.phone, rooms: record.rooms,
        opening_period: record.openingPeriod, feature: record.feature,
        avg_price: record.avgPrice, parking: record.parking,
        dining: record.dining, remark: record.remark, created_at: record.createdAt
    };
}
/** 基础信息：数据库下划线 → 前端驼峰 */
function basicFromSnakeCase(record) {
    return {
        name: record.name, address: record.address, owner: record.owner,
        phone: record.phone, rooms: record.rooms,
        openingPeriod: record.opening_period, feature: record.feature,
        avgPrice: record.avg_price, parking: record.parking,
        dining: record.dining, remark: record.remark, createdAt: record.created_at
    };
}
/** 评分：前端驼峰 → 数据库下划线 */
function scoreToSnakeCase(record) {
    return {
        homestay_name: record.name,     // 关联民宿名称
        must_checks: record.mustChecks,  // 必备项勾选状态(JSONB)
        dimensions: record.dimensions,   // 各维度评分明细(JSONB)
        total_score: record.totalScore,  // 总分
        grade: record.grade,             // 评级
        filled_by: record.filledBy       // 填报人昵称
    };
}
/** 评分：数据库下划线 → 前端驼峰 */
function scoreFromSnakeCase(record) {
    return {
        name: record.homestay_name,      // homestay_name → name
        mustChecks: record.must_checks,
        dimensions: record.dimensions,
        totalScore: record.total_score,
        grade: record.grade,
        filledBy: record.filled_by       // filled_by → filledBy
    };
}

/**
 * [云端读取] 从Supabase全量拉取两张表数据，写入localStorage并更新内存
 * 页面初始化时自动调用，实现多用户数据互通
 */
async function loadCloudAllData() {
    try {
        if (!supabaseClient) initSupabase();
        if (!isSupabaseReady) {
            console.warn('[云端加载] Supabase未就绪，使用本地缓存数据');
            return;
        }

        console.log('[云端加载] 正在拉取云端全量数据...');
        const { data: basicList, error: err1 } = await supabaseClient
            .from('homestay_basic').select('*');
        if (err1) throw err1;

        const { data: scoreList, error: err2 } = await supabaseClient
            .from('homestay_score').select('*');
        if (err2) throw err2;

        // 云端数据写入localStorage（覆盖本地缓存）
        // 云端下划线字段 → 前端驼峰格式
        const camelBasic = (basicList || []).map(basicFromSnakeCase);
        const camelScore = (scoreList || []).map(scoreFromSnakeCase);
        localStorage.setItem(STORAGE_KEY_BASIC, JSON.stringify(camelBasic));
        localStorage.setItem(STORAGE_KEY_SCORE, JSON.stringify(camelScore));

        // 更新内存中的全局数据
        basicData = camelBasic;
        scoreData = camelScore;

        console.log(`[云端加载] 成功！基础信息${basicData.length}条，评分${scoreData.length}条`);
        showToast(`☁️ 已同步云端数据（${basicData.length}家民宿）`, 'info', 2000);
    } catch (e) {
        console.error('[云端加载] 失败，回退使用本地缓存:', e.message);
        showToast('⚠ 云端数据加载失败，使用本地缓存数据', 'warning', 3000);
        // 失败时从localStorage恢复数据
        basicData = loadData(STORAGE_KEY_BASIC);
        scoreData = loadData(STORAGE_KEY_SCORE);
    }
}

/**
 * [云端写入] 向homestay_basic表upsert一条民宿基础信息（name字段作为冲突键）
 * @param {Object} record - 单条民宿基础信息数据
 */
async function cloudUpsertBasic(record) {
    if (!isSupabaseReady) return false;
    try {
        const dbRecord = basicToSnakeCase(record);
        const { error } = await supabaseClient
            .from('homestay_basic')
            .upsert(dbRecord, { onConflict: 'name' });
        if (error) throw error;
        console.log('[云端写入] homestay_basic upsert成功:', record.name);
        return true;
    } catch (e) {
        console.error('[云端写入] homestay_basic失败:', e.message);
        showToast('⚠ 云端保存失败，数据仅保存在本地', 'warning', 3000);
        return false;
    }
}

/**
 * [云端写入] 向homestay_score表insert一条评分（支持同一民宿多次提交）
 * @param {Object} record - 单条评分数据
 */
async function cloudUpsertScore(record) {
    if (!isSupabaseReady) return false;
    try {
        const dbRecord = scoreToSnakeCase(record);
        const { error } = await supabaseClient
            .from('homestay_score')
            .insert(dbRecord);
        if (error) throw error;
        console.log('[云端写入] homestay_score insert成功:', record.name);
        return true;
    } catch (e) {
        console.error('[云端写入] homestay_score失败:', e.message);
        showToast('⚠ 云端评分保存失败，数据仅保存在本地', 'warning', 3000);
        return false;
    }
}

/**
 * [云端删除] 从两张表中删除指定民宿的所有数据
 * @param {string} name - 民宿名称
 */
async function cloudDeleteRecord(name) {
    if (!isSupabaseReady) return;
    try {
        await supabaseClient.from('homestay_basic').delete().eq('name', name);
        await supabaseClient.from('homestay_score').delete().eq('homestay_name', name);
        console.log('[云端删除] 已删除:', name);
    } catch (e) {
        console.error('[云端删除] 失败:', e.message);
    }
}
/* ============================================================
   民宿信息收集+评分填报系统 - 主逻辑脚本
   功能：
     1. 民宿基础信息 增/删/改/查 + 表单校验 + 名称去重
     2. 民宿服务质量评分 7大维度实时计算 + 自动评级
     3. localStorage 本地持久化存储
     4. 一键导出 Excel（完全匹配原始台账格式）
     5. ECharts 实时可视化（柱状图/饼图/雷达图/条形图）
     6. Supabase 云端多人数据同步

   数据存储 key：
     - homestay_basic_data    → 基础信息数组 [{...}, ...]
     - homestay_score_data    → 评分数据数组 [{...}, ...]
   ============================================================ */

/* ============================================================
   零、全局常量与配置（可根据实际需要修改）
   ============================================================ */

/** localStorage 键名 */
const STORAGE_KEY_BASIC = 'homestay_basic_data';   // 基础信息
const STORAGE_KEY_SCORE = 'homestay_score_data';    // 评分数据
const STORAGE_KEY_FILLER_NAME = 'homestay_filler_name'; // 填报人昵称

/**
 * 6个评分维度的配置
 * 每个维度包含：id, name, maxScore（该维度总分上限）, items（子项列表）
 * 总分 = 各维度 maxScore 之和 = 20+20+15+20+10+15 = 100
 */
/** 6个评分维度（永汉镇温泉民宿标准，总分100分） */
const SCORE_DIMENSIONS = [
    {
        id: 'infra', name: '基础设施', maxScore: 20,
        items: [
            { name:'1.1 交通便利性',             maxScore:2, hint:'距主干道(S119/增龙路)≤3km有硬化路可达；有标识导引' },
            { name:'1.2 建筑外观与周边协调',      maxScore:2, hint:'与南昆山/竹海/客家村落风貌不冲突，无违建' },
            { name:'1.3 温泉水供应稳定性',        maxScore:5, hint:'24h热水或分时段公示清晰；私汤独立控温；⚠美团点评高频差评项，严卡扣分' },
            { name:'1.4 客房基础配置',             maxScore:4, hint:'家具齐全、编号清晰、照明充足、遮光窗帘、气候适配冷暖' },
            { name:'1.5 公共配套（庭院/公区/停车）',maxScore:4, hint:'停车≥客房数×0.5；有公区；别墅型有独立院落' },
            { name:'1.6 无障碍与适老',             maxScore:3, hint:'有1层客房或电梯、无障碍通道' }
        ]
    },
    {
        id: 'service', name: '服务质量', maxScore: 25,
        items: [
            { name:'2.1 主人/管家参与接待',        maxScore:4, hint:'主人或民宿主理人在场，能讲本地故事（南昆山、客家、温泉由来）' },
            { name:'2.2 接待人员仪容与礼仪',        maxScore:3, hint:'着装整洁、普通话达标，方言/英语加分' },
            { name:'2.3 业务熟练度',               maxScore:4, hint:'熟悉客房/餐饮/本地旅游资源（南昆山、218旅游公路、大观园）' },
            { name:'2.4 服务响应',                 maxScore:4, hint:'诉求30分钟内响应，有微信管家群' },
            { name:'2.5 特色服务供给',              maxScore:6, hint:'提供≥2项：私汤温度调节指导、本地农特产代购、山野徒步向导、节令活动' },
            { name:'2.6 投诉处理与反馈',            maxScore:4, hint:'公示投诉电话，有记录、有闭环' }
        ]
    },
    {
        id: 'hygiene', name: '环境卫生', maxScore: 20,
        items: [
            { name:'3.1 布草"每客必换"',          maxScore:5, hint:'床单被套枕套毛巾一客一换，公用品一客一消毒，有消毒柜可见' },
            { name:'3.2 客房/公区整洁度',          maxScore:4, hint:'无积尘、无异味、无死角' },
            { name:'3.3 私汤泡池卫生',             maxScore:5, hint:'换客必刷+换水/循环消毒，目视无沙无垢；⚠点评高频投诉项，严卡扣分' },
            { name:'3.4 卫生间防潮通风',            maxScore:3, hint:'每日清理≥1次，无异味无积水' },
            { name:'3.5 防虫防蛇防鼠',             maxScore:3, hint:'永汉靠山靠林，此项不能省' }
        ]
    },
    {
        id: 'safety', name: '安全管理', maxScore: 15,
        items: [
            { name:'4.1 安全警示标识',              maxScore:2, hint:'楼梯、泳池、泡池、陡坡处齐全，符合GB 2894' },
            { name:'4.2 消防合规',                 maxScore:4, hint:'灭火器/烟感/疏散图齐全，农家乐防火导则达标' },
            { name:'4.3 突发预案+演练',            maxScore:3, hint:'有预案、有记录（半年≥1次）' },
            { name:'4.4 监控覆盖',                 maxScore:2, hint:'围墙、出入口、公区，画面留存≥30天' },
            { name:'4.5 食品安全（若供餐）',        maxScore:2, hint:'生熟分柜、消毒设施有效' },
            { name:'4.6 公众责任险',               maxScore:2, hint:'已购，保单在有效期内' }
        ]
    },
    {
        id: 'culture', name: '文化特色', maxScore: 10,
        items: [
            { name:'5.1 建筑/装修地域性',           maxScore:3, hint:'客家元素、竹木材质、南昆山石/竹运用，拒绝"全国连锁风"' },
            { name:'5.2 本地体验项目',              maxScore:3, hint:'温泉文化讲解、客家菜（龙门胡须鸡、山坑螺、年饼）、竹编/采茶等' },
            { name:'5.3 文创/特产带动',             maxScore:2, hint:'销售本地农产（龙门大米、蜂蜜、笋干）或有自营文创' },
            { name:'5.4 社区贡献',                 maxScore:2, hint:'聘用本地村民、参与村社公益、带动周边农家乐' }
        ]
    },
    {
        id: 'facility', name: '设施设备', maxScore: 10,
        items: [
            { name:'6.1 客房家具品质',              maxScore:2, hint:'乙级"品质较好"、甲级"品质优良"，按梯度打分' },
            { name:'6.2 布草间独立+整洁',          maxScore:2, hint:'甲级必备项，永汉别墅型容易忽略' },
            { name:'6.3 消洗区独立',               maxScore:1, hint:'清洗消毒分区' },
            { name:'6.4 网络与智能',               maxScore:2, hint:'全域WiFi、智能门锁、可选全屋智能' },
            { name:'6.5 休闲设施',                 maxScore:2, hint:'泳池/KTV/麻将/烧烤/茶室≥2项' },
            { name:'6.6 维保记录',                 maxScore:1, hint:'设施定期检查有台账' }
        ]
    }
];

/** 必备项清单（18项，任意一项不达标→不定级） */
const MUST_ITEMS = [
    { id:'A1',  label:'证照齐全合法经营',             detail:'营业执照、特行许可、消防、卫生、食品（若供餐）齐全' },
    { id:'A2',  label:'正式开业≥1年',                 detail:'且在广东省旅游民宿管理系统备案' },
    { id:'A3',  label:'建筑规模合规',                   detail:'客房楼≤4层，建筑面积≤800㎡' },
    { id:'A4',  label:'治安/环保/安全合规',            detail:'近1年无相关违法记录，符合属地公安、生态环境、应急管理要求' },
    { id:'A5',  label:'温泉水源可溯源',                 detail:'自有井取水许可或集中供温泉管网合同；水质检测报告在有效期内' },
    { id:'A6',  label:'安全警示标识',                   detail:'楼梯/泳池/泡池/陡坡处齐全，符合GB 2894' },
    { id:'A7',  label:'危化品管理',                     detail:'易燃物贮存符合GB 15603（温泉区硫磺/消毒药剂重点管控）' },
    { id:'A8',  label:'安全制度+预案+演练',            detail:'有文本预案+半年≥1次演练记录' },
    { id:'A9',  label:'食品合规（若供餐）',            detail:'符合GB 31654，生熟分柜、消毒设施有效' },
    { id:'A10', label:'卫生达标',                       detail:'符合GB 37487、GB 37488' },
    { id:'A11', label:'生活用水达标',                   detail:'符合GB 5749（含自备井/二次供水检测）' },
    { id:'A12', label:'装修用材合规',                   detail:'符合GB 50016' },
    { id:'A13', label:'从业人员持证',                   detail:'健康证、消防培训证等按岗配齐' },
    { id:'A14', label:'垃圾分类+污水',                 detail:'截污纳管或自行处理达GB 8978' },
    { id:'A15', label:'服务明码标价',                   detail:'收费项目文字图形公示，标价清晰' },
    { id:'A16', label:'进入性良好',                     detail:'S119/增龙路可达，有硬化路、标识导引' },
    { id:'A17', label:'建筑外观协调',                   detail:'与南昆山/竹海/客家村落风貌不冲突，无违建' },
    { id:'A18', label:'公众责任险',                     detail:'保单在有效期内' }
];

/**
 * 评分等级映射
 * @param {number} score - 总分
 * @returns {{ grade: string, cssClass: string }} 等级名称和CSS类名
 */
/**
 * 永汉镇温泉民宿等级判定
 * @param {number} score - 总分
 * @param {boolean} mustAllPassed - 必备项是否全部达标（默认true）
 * @param {number} cultureScore - 文化特色维度得分（金宿门槛≥8）
 * @param {number} item13Score - 1.3温泉水供应稳定性得分（金宿门槛>0）
 * @param {number} item33Score - 3.3私汤泡池卫生得分（金宿门槛>0）
 */
function getGradeInfo(score, mustAllPassed = true, cultureScore = 0, item13Score = 0, item33Score = 0) {
    // 一票否决：必备项不达标 或 总分<70 → 不定级
    if (!mustAllPassed || score < 70) {
        return { grade: '不定级', cssClass: 'grade-fail', isVeto: !mustAllPassed };
    }
    // 永汉金宿：≥90分 + 文化特色≥8 + 温泉供应>0 + 私汤卫生>0
    if (score >= 90 && cultureScore >= 8 && item13Score > 0 && item33Score > 0) {
        return { grade: '永汉金宿', cssClass: 'grade-gold' };
    }
    if (score >= 80) return { grade: '永汉银宿', cssClass: 'grade-silver' };
    if (score >= 70) return { grade: '永汉铜宿', cssClass: 'grade-bronze' };
    return { grade: '不定级', cssClass: 'grade-fail' };
}

/* ============================================================
   一、数据管理模块（localStorage 读写）
   ============================================================ */

/**
 * 从 localStorage 读取数据
 * @param {string} key - 存储键名
 * @param {*} defaultValue - 默认值
 * @returns {*} 解析后的数据
 */
function loadData(key, defaultValue = []) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return defaultValue;
        const parsed = JSON.parse(raw);
        // 确保返回数组（防止非数组数据损坏）
        return Array.isArray(parsed) ? parsed : defaultValue;
    } catch (e) {
        console.warn('[数据加载失败]', key, e.message);
        return defaultValue;
    }
}

/**
 * 获取/设置填报人昵称（localStorage 持久记忆）
 * 首次使用时弹出输入框，后续自动记住
 * @returns {string} 昵称
 */
function getFillerName() {
    let name = localStorage.getItem(STORAGE_KEY_FILLER_NAME);
    if (!name || name.trim() === '') {
        name = prompt('请输入您的昵称（用于标识填报人）：', '');
        if (!name || name.trim() === '') name = '匿名用户';
        localStorage.setItem(STORAGE_KEY_FILLER_NAME, name.trim());
    }
    return name.trim();
}

/**
 * 保存数据到 localStorage
 * @param {string} key - 存储键名
 * @param {*} data - 要存储的数据
 */
function saveData(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
        console.error('[数据保存失败]', key, e.message);
        showToast('数据保存失败，请检查浏览器存储空间', 'error');
    }
}

/** 全局数据：页面加载时从 localStorage 读取 */
let basicData = loadData(STORAGE_KEY_BASIC);
let scoreData = loadData(STORAGE_KEY_SCORE);

/* ============================================================
   二、Toast 消息提示模块
   ============================================================ */

/**
 * 显示 Toast 消息
 * @param {string} msg - 消息内容
 * @param {'success'|'error'|'warning'|'info'} type - 消息类型
 * @param {number} duration - 显示时长（毫秒），默认2500
 */
function showToast(msg, type = 'info', duration = 2500) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    container.appendChild(toast);

    // 动画结束后移除DOM元素
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, duration + 400);
}

/* ============================================================
   三、民宿基础信息表单模块
   ============================================================ */

/**
 * 获取基础信息表单当前填写值
 * @returns {Object} 表单数据对象
 */
function getBasicFormData() {
    return {
        name: document.getElementById('name').value.trim(),
        address: document.getElementById('address').value.trim(),
        owner: document.getElementById('owner').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        rooms: document.getElementById('rooms').value.trim(),
        openingPeriod: document.getElementById('openingPeriod').value,
        feature: document.getElementById('feature').value.trim(),
        avgPrice: document.getElementById('avgPrice').value.trim(),
        parking: document.getElementById('parking').value,
        dining: document.getElementById('dining').value,
        remark: document.getElementById('remark').value.trim()
    };
}

/**
 * 检查民宿名称是否已存在（去重校验）
 * @param {string} name - 民宿名称
 * @param {string|null} excludeIndex - 排除的索引（编辑模式时排除自身）
 * @returns {boolean} true=已存在
 */
function isNameDuplicate(name, excludeIndex = null) {
    return basicData.some((item, idx) => {
        if (excludeIndex !== null && String(idx) === String(excludeIndex)) return false;
        return item.name === name;
    });
}

/**
 * 实时校验民宿名称唯一性（绑定 input 事件）
 */
function checkNameUnique() {
    const nameInput = document.getElementById('name');
    const errEl = document.getElementById('err-name');
    const name = nameInput.value.trim();

    // 编辑模式（readOnly）下跳过重复校验
    if (nameInput.readOnly) {
        errEl.textContent = '';
        nameInput.classList.remove('error', 'success');
        return;
    }

    if (!name) {
        errEl.textContent = '';
        nameInput.classList.remove('error', 'success');
        return;
    }

    if (isNameDuplicate(name)) {
        errEl.textContent = '⚠ 该民宿名称已存在，请勿重复填报';
        nameInput.classList.add('error');
        nameInput.classList.remove('success');
    } else {
        errEl.textContent = '✓ 名称可用';
        nameInput.classList.add('success');
        nameInput.classList.remove('error');
    }
}

/**
 * 校验基础信息表单
 * @returns {{ valid: boolean, errors: Object }} 校验结果
 */
function validateBasicForm() {
    const data = getBasicFormData();
    const errors = {};
    let valid = true;

    // 1. 民宿名称：必填 + 不重复（编辑模式且名称未变时跳过重复检查）
    if (!data.name) {
        errors.name = '请输入民宿名称';
        valid = false;
    } else if (!document.getElementById('name').readOnly && isNameDuplicate(data.name)) {
        // readOnly=true 时说明正在编辑已有记录，名称未改变，不需重复检查
        errors.name = '该名称已存在，请更换';
        valid = false;
    }

    // 2. 地址：必填
    if (!data.address) {
        errors.address = '请输入地址';
        valid = false;
    }

    // 3. 业主：必填
    if (!data.owner) {
        errors.owner = '请输入业主姓名';
        valid = false;
    }

    // 4. 联系方式：必填 + 手机号格式
    if (!data.phone) {
        errors.phone = '请输入联系方式';
        valid = false;
    } else if (!/^1[3-9]\d{9}$/.test(data.phone)) {
        errors.phone = '请输入正确的11位手机号';
        valid = false;
    }

    // 5. 房间数：必填 + 正整数
    if (!data.rooms) {
        errors.rooms = '请输入房间数';
        valid = false;
    } else if (!/^\d+$/.test(data.rooms) || parseInt(data.rooms) < 1) {
        errors.rooms = '请输入正整数';
        valid = false;
    }

    // 6. 开业时间：必填
    if (!data.openingPeriod) {
        errors.openingPeriod = '请选择开业时间';
        valid = false;
    }

    // 7. 停车场：必填
    if (!data.parking) {
        errors.parking = '请选择停车场配套情况';
        valid = false;
    }

    // 8. 餐饮：必填
    if (!data.dining) {
        errors.dining = '请选择餐饮配套情况';
        valid = false;
    }

    return { valid, errors };
}

/**
 * 显示表单校验错误
 * @param {Object} errors - 错误对象 { fieldName: message }
 */
function showBasicErrors(errors) {
    // 先清除所有错误
    document.querySelectorAll('#formBasic .error-msg').forEach(el => el.textContent = '');
    document.querySelectorAll('#formBasic input.error, #formBasic select.error').forEach(el => el.classList.remove('error'));

    // 显示新错误
    for (const [field, msg] of Object.entries(errors)) {
        const errEl = document.getElementById('err-' + field);
        const inputEl = document.getElementById(field);
        if (errEl) errEl.textContent = msg;
        if (inputEl) inputEl.classList.add('error');
    }
}

/**
 * 更新基础信息表单的必填进度条
 */
function updateBasicProgress() {
    const data = getBasicFormData();
    const requiredFields = ['name', 'address', 'owner', 'phone', 'rooms', 'openingPeriod', 'parking', 'dining'];
    const filled = requiredFields.filter(f => {
        const val = data[f];
        return val !== null && val !== undefined && String(val).trim() !== '';
    }).length;
    const total = requiredFields.length;
    const pct = Math.round((filled / total) * 100);

    document.getElementById('progressBasicText').textContent = `必填项完成：${filled}/${total}`;
    document.getElementById('progressBasicBar').style.width = pct + '%';
}

/**
 * 保存基础信息（新增或更新）
 */
function saveBasicInfo() {
    const { valid, errors } = validateBasicForm();
    showBasicErrors(errors);

    if (!valid) {
        showToast('请先完善必填信息，红色字段需要修正', 'warning');
        return;
    }

    const data = getBasicFormData();
    // 处理数字字段
    data.rooms = parseInt(data.rooms) || 0;
    data.avgPrice = data.avgPrice ? parseFloat(data.avgPrice) : '';
    // 添加记录时间戳
    data.createdAt = new Date().toISOString();

    // 检查是否为编辑已有记录
    const existingIndex = basicData.findIndex(item => item.name === data.name);
    if (existingIndex >= 0) {
        // 更新已有记录（保留原有评分关联，不改变名称字段）
        basicData[existingIndex] = { ...basicData[existingIndex], ...data, name: basicData[existingIndex].name };
        showToast(`✅ 已更新「${data.name}」的基础信息`, 'success');
    } else {
        basicData.push(data);
        showToast(`✅ 已添加「${data.name}」`, 'success');
    }

    // 本地存储
    saveData(STORAGE_KEY_BASIC, basicData);

    // 云端同步写入（异步，不阻塞本地操作）
    cloudUpsertBasic(data);

    clearBasicForm();
    refreshAll(); // 刷新列表、预览、图表、评分下拉
}

/**
 * 清空基础信息表单
 */
function clearBasicForm() {
    document.getElementById('formBasic').reset();
    document.querySelectorAll('#formBasic .error-msg').forEach(el => el.textContent = '');
    document.querySelectorAll('#formBasic input.error, #formBasic select.error').forEach(el => el.classList.remove('error'));
    document.querySelectorAll('#formBasic input.success').forEach(el => el.classList.remove('success'));

    // 如果处于编辑模式，恢复名称字段可编辑状态
    const nameInput = document.getElementById('name');
    if (nameInput.readOnly) {
        nameInput.readOnly = false;
        nameInput.style.background = '';
        const labelTip = document.querySelector('label[for="name"] .label-tip');
        if (labelTip) labelTip.textContent = '（不可重复）';
    }

    updateBasicProgress();
}

/* ============================================================
   四、民宿评分表单模块
   ============================================================ */

/**
 * 动态渲染评分表单的子项
 * 页面加载时调用一次即可
 */
function renderScoringForm() {
    // 1. 渲染必备项
    const mustContainer = document.getElementById('mustItems');
    mustContainer.innerHTML = MUST_ITEMS.map((item, i) => `
        <div class="must-item" title="${escapeHtml(item.detail || '')}">
            <input type="checkbox" id="must_${i}" data-must="${item.id}">
            <label for="must_${i}"><strong>${item.id}</strong> ${item.label}</label>
            <span class="must-detail">${escapeHtml(item.detail || '')}</span>
        </div>
    `).join('');

    // 2. 渲染6个评分维度
    SCORE_DIMENSIONS.forEach(dim => {
        const container = document.getElementById('score' + dim.id.charAt(0).toUpperCase() + dim.id.slice(1));
        if (!container) return;

        container.innerHTML = dim.items.map((item, i) => {
            const hintAttr = item.hint ? ` title="${escapeHtml(item.hint)}"` : '';
            return `
            <div class="score-item"${hintAttr}>
                <label for="score_${dim.id}_${i}">
                    ${item.name}
                    ${item.hint ? '<span class="score-hint">' + escapeHtml(item.hint) + '</span>' : ''}
                </label>
                <input type="number"
                       id="score_${dim.id}_${i}"
                       min="0"
                       max="${item.maxScore}"
                       step="0.5"
                       value=""
                       placeholder="0"
                       data-dim="${dim.id}"
                       data-index="${i}"
                       data-max="${item.maxScore}">
                <span class="score-max-tag">/${item.maxScore}</span>
            </div>
        `}).join('');
    });

    // 3. 绑定所有评分输入事件（单项上限校验 + 实时计算）
    document.querySelectorAll('.score-grid input[type="number"]').forEach(input => {
        // 输入前校验：防负数、自动截断、仅数字
        input.addEventListener('input', function() { validateScoreInput(this); });
        // 输入后联动：重算总分+等级
        input.addEventListener('input', recalculateAllScores);
        // 失去焦点再次校验
        input.addEventListener('blur', function() { validateScoreInput(this); });
    });

    // 4. 绑定必备项checkbox事件
    document.querySelectorAll('.must-grid input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', updateScorePreview);
    });
}

/**
 * [需求1] 评分输入框单项上限实时校验
 * - 禁止负数 → 自动置0
 * - 超过该项满分上限 → 自动截断为满分 + toast轻提示
 * - 仅允许数字输入
 * @param {HTMLInputElement} input - 评分输入框DOM元素
 */
function validateScoreInput(input) {
    let raw = input.value.trim();

    // 空值放行（允许清空）
    if (raw === '') return;

    // 移除非法字符（非数字、非小数点）
    let cleaned = raw.replace(/[^0-9.]/g, '');
    // 只保留第一个小数点
    const dotIdx = cleaned.indexOf('.');
    if (dotIdx >= 0) {
        cleaned = cleaned.slice(0, dotIdx + 1) + cleaned.slice(dotIdx + 1).replace(/./g, '');
    }
    if (cleaned !== raw) {
        input.value = cleaned;
        raw = cleaned;
    }

    let val = parseFloat(raw);
    if (isNaN(val)) return;

    // 负数 → 归零
    if (val < 0) {
        input.value = '0';
        return;
    }

    // 获取该项满分上限（从 data-max 属性读取）
    const maxScore = parseFloat(input.dataset.max);
    if (!isNaN(maxScore) && val > maxScore) {
        input.value = maxScore;
        // 轻提示（防抖：200ms内同一输入框不重复弹）
        const now = Date.now();
        const lastToast = parseInt(input.dataset.lastToast || '0');
        if (now - lastToast > 1500) {
            input.dataset.lastToast = now;
            showToast('⚠ 该项最高' + maxScore + '分，已自动修正', 'warning', 2000);
        }
    }
}

/**
 * 获取某个维度的所有分数输入值
/**
 * 获取某个维度的所有分数输入值
 * @param {string} dimId - 维度ID
 * @returns {number[]} 分数数组
 */
function getDimensionScores(dimId) {
    const inputs = document.querySelectorAll(`input[data-dim="${dimId}"]`);
    return Array.from(inputs).map(inp => {
        let val = parseFloat(inp.value);
        if (isNaN(val) || val < 0) return 0;
        // 双重保险：超过单项上限时截断
        const max = parseFloat(inp.dataset.max);
        if (!isNaN(max) && val > max) val = max;
        return val;
    });
}

/**
 * 获取完整的评分表单数据
 * @returns {Object} 评分数据
 */
function getScoringFormData() {
    const target = document.getElementById('scoreTarget').value;

    // 收集必备项勾选状态
    const mustChecks = {};
    let mustAllPassed = true;
    document.querySelectorAll('.must-grid input[type="checkbox"]').forEach(cb => {
        mustChecks[cb.dataset.must] = cb.checked;
        if (!cb.checked) mustAllPassed = false;
    });

    // 收集各维度分数
    const dimensions = {};
    let totalScore = 0;
    let cultureSubtotal = 0;
    let item13Score = 0;  // 1.3 温泉水供应稳定性
    let item33Score = 0;  // 3.3 私汤泡池卫生
    SCORE_DIMENSIONS.forEach(dim => {
        const scores = getDimensionScores(dim.id);
        const subtotal = scores.reduce((sum, s) => sum + s, 0);
        const clampedSubtotal = Math.min(subtotal, dim.maxScore);
        dimensions[dim.id] = {
            name: dim.name,
            maxScore: dim.maxScore,
            items: dim.items.map((item, i) => ({ name: item.name || item, score: scores[i], maxScore: item.maxScore || dim.maxScore })),
            subtotal: clampedSubtotal
        };
        totalScore += clampedSubtotal;
        // 捕获金宿门槛关键得分
        if (dim.id === 'culture') cultureSubtotal = clampedSubtotal;
        if (dim.id === 'infra' && dim.items[2]) item13Score = scores[2] || 0;
        if (dim.id === 'hygiene' && dim.items[2]) item33Score = scores[2] || 0;
    });

    const roundedTotal = Math.round(totalScore * 10) / 10;
    const gradeInfo = getGradeInfo(roundedTotal, mustAllPassed, cultureSubtotal, item13Score, item33Score);

    return {
        name: target,
        mustChecks,
        mustAllPassed,
        dimensions,
        totalScore: roundedTotal,
        grade: gradeInfo.grade,
        gradeDetail: gradeInfo,
        filledBy: getFillerName()
    };
}

/**
 * 实时重新计算所有维度分数和总分
 * 核心计算逻辑：每个维度的分项之和 ≤ 该维度上限
 * 总分 = 各维度实际得分（不超过上限）之和
 */
function recalculateAllScores() {
    let grandTotal = 0;
    let hasError = false;

    SCORE_DIMENSIONS.forEach(dim => {
        const scores = getDimensionScores(dim.id);
        const rawSum = scores.reduce((sum, s) => sum + s, 0);
        const clampedSum = Math.min(rawSum, dim.maxScore);
        grandTotal += clampedSum;

        // 更新维度小计显示
        const subtotalEl = document.getElementById('subtotal' + dim.id.charAt(0).toUpperCase() + dim.id.slice(1));
        const errEl = document.getElementById('err' + dim.id.charAt(0).toUpperCase() + dim.id.slice(1));

        if (subtotalEl) {
            subtotalEl.textContent = clampedSum.toFixed(1);
            // 超限标红
            if (rawSum > dim.maxScore) {
                subtotalEl.style.color = 'var(--color-danger)';
                if (errEl) errEl.textContent = `⚠ 超出上限${dim.maxScore}分，已按${dim.maxScore}分计算`;
                hasError = true;
            } else {
                subtotalEl.style.color = 'var(--color-primary)';
                if (errEl) errEl.textContent = '';
            }
        }

        // 标红超限的输入框
        dim.items.forEach((_, i) => {
            const inp = document.getElementById(`score_${dim.id}_${i}`);
            if (inp) {
                const val = parseFloat(inp.value);
                if (!isNaN(val) && val < 0) {
                    inp.classList.add('error');
                } else {
                    inp.classList.remove('error');
                }
            }
        });
    });

    // 更新总分
    const roundedTotal = Math.round(grandTotal * 10) / 10;
    document.getElementById('totalScore').textContent = roundedTotal.toFixed(1);

    // 获取必备项状态和金宿门槛
    let mustAllPassed = true;
    document.querySelectorAll('.must-grid input[type="checkbox"]').forEach(cb => {
        if (!cb.checked) mustAllPassed = false;
    });
    // 获取文化特色、1.3、3.3得分用于金宿判定
    const cultureScores = getDimensionScores('culture');
    const cultureSubtotal = Math.min(cultureScores.reduce((s, v) => s + v, 0), 10);
    const infraScores = getDimensionScores('infra');
    const item13Score = infraScores[2] || 0;
    const hygieneScores = getDimensionScores('hygiene');
    const item33Score = hygieneScores[2] || 0;

    const gradeInfo = getGradeInfo(roundedTotal, mustAllPassed, cultureSubtotal, item13Score, item33Score);
    const gradeEl = document.getElementById('totalGrade');
    gradeEl.textContent = gradeInfo.grade + (gradeInfo.isVeto ? '（必备项不达标）' : '');
    gradeEl.className = 'total-grade ' + gradeInfo.cssClass;

    // 更新预览
    updateScorePreview();
}

/**
 * 更新评分预览（在右侧面板显示当前评分数据）
 */
function updateScorePreview() {
    const data = getScoringFormData();
    const previewEl = document.getElementById('latestEntry');

    if (!data.name) {
        previewEl.innerHTML = '<p class="muted-text">请先选择民宿并填写评分</p>';
        return;
    }

    const mustChecked = Object.values(data.mustChecks).filter(Boolean).length;
    const mustTotal = MUST_ITEMS.length;

    const vetoWarn = !data.mustAllPassed
        ? '<div style="color:var(--color-danger);font-weight:700;margin-bottom:6px;">⚠ 必备项不达标 → 不定级</div>'
        : '';
    previewEl.innerHTML = `
        ${vetoWarn}
        <div style="font-weight:700;margin-bottom:8px;">📝 当前评分预览：${data.name}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:0.82rem;">
            ${SCORE_DIMENSIONS.map(dim => {
                const d = data.dimensions[dim.id];
                const pct = Math.round((d.subtotal / dim.maxScore) * 100);
                return `<span>${dim.name}</span><span style="color:var(--color-primary);font-weight:600;">${d.subtotal.toFixed(1)}/${dim.maxScore} (${pct}%)</span>`;
            }).join('')}
            <span style="font-weight:700;">总分</span><span style="font-weight:800;color:var(--color-primary);">${data.totalScore.toFixed(1)}/100</span>
            <span>必备项核查</span><span style="color:${mustChecked === mustTotal ? 'var(--color-success)' : 'var(--color-danger)'};font-weight:700;">${mustChecked}/${mustTotal} ${mustChecked === mustTotal ? '✅ 全部达标' : '⚠ 有未达标项'}</span>
        </div>
    `;
}

/**
 * 校验评分表单
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateScoringForm() {
    const errors = [];
    const target = document.getElementById('scoreTarget').value;

    if (!target) {
        errors.push('请先选择要评分的民宿');
    }

    // 同一民宿允许多次评分，无需检查重复

    const data = getScoringFormData();
    if (!data.mustAllPassed) {
        errors.push('⚠ 必备项不达标，无法参与评级，直接判定为"不定级"。是否继续保存？');
    }
    if (data.totalScore <= 0 && !Object.values(data.mustChecks).some(Boolean)) {
        errors.push('请至少填写评分或勾选必备项');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * 保存评分数据
 */
function saveScoringData() {
    const { valid, errors } = validateScoringForm();

    if (!valid) {
        showToast(errors[0], 'warning');
        return;
    }

    const data = getScoringFormData();

    // 追加新评分记录（同一民宿允许多次评分，不做覆盖）
    scoreData.push(data);

    // 本地存储
    saveData(STORAGE_KEY_SCORE, scoreData);

    // 云端同步写入（异步，不阻塞本地操作）
    cloudUpsertScore(data);

    showToast(`✅ 已新增「${data.name}」的评分（${data.totalScore}分/${data.grade}）`, 'success');
    clearScoringForm();
    refreshAll();
}

/**
 * 清空评分表单
 */
function clearScoringForm() {
    document.querySelectorAll('#formScoring input[type="number"]').forEach(inp => inp.value = '');
    document.querySelectorAll('#formScoring input[type="checkbox"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('.dim-error').forEach(el => el.textContent = '');
    SCORE_DIMENSIONS.forEach(dim => {
        const subtotalEl = document.getElementById('subtotal' + dim.id.charAt(0).toUpperCase() + dim.id.slice(1));
        if (subtotalEl) { subtotalEl.textContent = '0'; subtotalEl.style.color = 'var(--color-primary)'; }
    });
    document.getElementById('totalScore').textContent = '0';
    const gradeEl = document.getElementById('totalGrade');
    gradeEl.textContent = '--';
    gradeEl.className = 'total-grade grade-none';
    updateScorePreview();
}

/**
 * 刷新评分对象下拉列表
 */
function refreshScoreTargetSelect() {
    const select = document.getElementById('scoreTarget');
    const currentVal = select.value; // 保留当前选择

    // 统计每个民宿的评分次数
    const scoreCount = {};
    scoreData.forEach(s => { scoreCount[s.name] = (scoreCount[s.name] || 0) + 1; });

    select.innerHTML = '<option value="">-- 请先选择民宿 --</option>'
        + basicData.map((item) => {
            const cnt = scoreCount[item.name] || 0;
            return `<option value="${item.name}">
                ${item.name}${cnt > 0 ? ' (' + cnt + '次评分)' : ''}
            </option>`;
        }).join('');

    // 尝试恢复之前的选择
    if (currentVal && basicData.some(b => b.name === currentVal)) {
        select.value = currentVal;
    }
}

/**
 * 当评分目标改变时，加载已有评分数据
 */
function onScoreTargetChange() {
    const target = document.getElementById('scoreTarget').value;
    clearScoringForm();

    if (!target) return;

    // 查找该民宿所有评分记录，取最新一条回填
    const allScores = scoreData.filter(s => s.name === target);
    const existing = allScores.length > 0 ? allScores[allScores.length - 1] : null;
    if (existing) {
        // 回填必备项
        for (const [key, checked] of Object.entries(existing.mustChecks || {})) {
            const cb = document.querySelector(`input[data-must="${key}"]`);
            if (cb) cb.checked = checked;
        }

        // 回填各维度分数
        for (const [dimId, dimData] of Object.entries(existing.dimensions || {})) {
            (dimData.items || []).forEach((item, i) => {
                const inp = document.getElementById(`score_${dimId}_${i}`);
                if (inp && item.score > 0) {
                    inp.value = item.score;
                }
            });
        }

        recalculateAllScores();
        showToast(`已加载「${target}」的评分记录`, 'info');
    }
}

/* ============================================================
   五、数据列表 / 表格模块
   ============================================================ */

/**
 * 刷新民宿数据列表
 */
function refreshDataList() {
    const tbody = document.getElementById('dataTableBody');
    const searchTerm = (document.getElementById('listSearch')?.value || '').trim().toLowerCase();

    // 筛选
    let filtered = basicData.map((item, i) => ({ ...item, _index: i }));
    if (searchTerm) {
        filtered = filtered.filter(item =>
            item.name.toLowerCase().includes(searchTerm) ||
            (item.address || '').toLowerCase().includes(searchTerm) ||
            (item.owner || '').toLowerCase().includes(searchTerm)
        );
    }

    document.getElementById('listCount').textContent = `共 ${filtered.length} 条记录`;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="7">
            ${searchTerm ? '未找到匹配的民宿' : '暂无数据，请先添加民宿信息'}
        </td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map((item, displayIndex) => {
        // 统计该民宿所有评分记录，计算平均分
        const allScores = scoreData.filter(s => s.name === item.name);
        const scoreCount = allScores.length;
        const avgScore = scoreCount > 0
            ? Math.round(allScores.reduce((s, r) => s + r.totalScore, 0) / scoreCount * 10) / 10
            : null;
        const latestGrade = scoreCount > 0 ? allScores[allScores.length - 1].grade : null;
        const scoreDisplay = avgScore !== null
            ? `<span title="${scoreCount}次评分 | 平均${avgScore}分">${avgScore}分 <small>(${scoreCount}次)</small></span>`
            : '<span style="color:var(--color-text-muted);">未评分</span>';
        const gradeDisplay = latestGrade
            ? `<span class="grade-badge ${getGradeInfo(avgScore).cssClass}">${latestGrade}</span>`
            : '<span style="color:var(--color-text-muted);">--</span>';

        return `
            <tr>
                <td>${displayIndex + 1}</td>
                <td><strong>${escapeHtml(item.name)}</strong></td>
                <td title="${escapeHtml(item.address || '')}">${truncateText(item.address, 15)}</td>
                <td>${escapeHtml(item.owner || '')}</td>
                <td>${scoreDisplay}</td>
                <td>${gradeDisplay}</td>
                <td>
                    <button class="btn btn-outline btn-sm" onclick="editBasicInfo(${item._index})" title="编辑">✏️</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteRecord(${item._index})" title="删除">🗑</button>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * 编辑民宿基础信息（回填到表单）
 * @param {number} index - 数据索引
 */
function editBasicInfo(index) {
    const item = basicData[index];
    if (!item) return;

    // 切换到基础信息标签
    document.querySelector('.tab-btn[data-tab="tab-basic"]').click();

    // 回填数据
    document.getElementById('name').value = item.name || '';
    document.getElementById('address').value = item.address || '';
    document.getElementById('owner').value = item.owner || '';
    document.getElementById('phone').value = item.phone || '';
    document.getElementById('rooms').value = item.rooms || '';
    document.getElementById('openingPeriod').value = item.openingPeriod || '';
    document.getElementById('feature').value = item.feature || '';
    document.getElementById('avgPrice').value = item.avgPrice || '';
    document.getElementById('parking').value = item.parking || '';
    document.getElementById('dining').value = item.dining || '';
    document.getElementById('remark').value = item.remark || '';

    // name字段设只读（编辑已有记录不允许改名称，避免评分关联丢失）
    document.getElementById('name').readOnly = true;
    document.getElementById('name').style.background = 'var(--color-bg)';
    // 添加提示
    const nameLabel = document.querySelector('label[for="name"]');
    nameLabel.querySelector('.label-tip').textContent = '（编辑模式，名称不可修改）';

    updateBasicProgress();
    showToast(`正在编辑「${item.name}」，修改后点击"保存信息"`, 'info');

    // 滚动到顶部
    document.getElementById('panelContent').scrollTop = 0;
}

/**
 * 删除记录（基础信息+关联评分）
 * @param {number} index - 数据索引
 */
function deleteRecord(index) {
    const item = basicData[index];
    if (!item) return;

    if (!confirm(`确定删除「${item.name}」吗？\n\n该操作将同时删除关联的评分数据，且无法恢复！`)) {
        return;
    }

    const name = item.name;
    basicData.splice(index, 1);
    // 同时删除关联的评分数据
    scoreData = scoreData.filter(s => s.name !== name);

    // 本地存储
    saveData(STORAGE_KEY_BASIC, basicData);
    saveData(STORAGE_KEY_SCORE, scoreData);

    // 云端同步删除（异步，不阻塞本地操作）
    cloudDeleteRecord(name);

    showToast(`已删除「${name}」及其评分数据`, 'warning');
    refreshAll();
}

/* ============================================================
   六、工具函数
   ============================================================ */

/**
 * HTML 转义（防XSS）
 * @param {string} str - 原始字符串
 * @returns {string} 转义后字符串
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * 文本截断
 * @param {string} str - 原始字符串
 * @param {number} maxLen - 最大长度
 * @returns {string}
 */
function truncateText(str, maxLen = 20) {
    if (!str) return '';
    return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

/* ============================================================
   七、Excel 导出模块
   使用 SheetJS (xlsx) 库，格式完全匹配原始台账
   ============================================================ */

/**
 * 导出基础信息台账 Excel
 * 格式：标题行 + 表头行 + 数据行（与原始台账结构一致）
 */
function exportBasicExcel() {
    if (basicData.length === 0) {
        showToast('暂无数据可导出，请先添加民宿信息', 'warning');
        return;
    }

    // SheetJS 需要二维数组构建 sheet
    const rows = [];

    // 第1行：台账标题（合并单元格通过!merges实现）
    rows.push(['民宿基本信息台账', '', '', '', '', '', '', '', '', '', '']);

    // 第2行：表头
    rows.push(['民宿名称', '地址', '业主', '联系方式', '房间数', '开业时间', '特色', '人均价格', '停车场配套情况', '餐饮配套情况', '备注']);

    // 数据行
    basicData.forEach(item => {
        rows.push([
            item.name || '',
            item.address || '',
            item.owner || '',
            item.phone || '',
            item.rooms || '',
            item.openingPeriod || '',
            item.feature || '',
            item.avgPrice || '',
            item.parking || '',
            item.dining || '',
            item.remark || ''
        ]);
    });

    // 创建工作簿
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // 设置列宽（近似原始台账列宽）
    ws['!cols'] = [
        { wch: 18 }, // 民宿名称
        { wch: 30 }, // 地址
        { wch: 10 }, // 业主
        { wch: 14 }, // 联系方式
        { wch: 8 },  // 房间数
        { wch: 10 }, // 开业时间
        { wch: 20 }, // 特色
        { wch: 10 }, // 人均价格
        { wch: 18 }, // 停车场
        { wch: 16 }, // 餐饮
        { wch: 25 }  // 备注
    ];

    // 合并标题行
    ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '民宿信息台账');

    // 触发下载
    const timestamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `民宿基本信息台账_导出_${timestamp}.xlsx`);
    showToast('✅ 基础信息台账已导出', 'success');
}

/**
 * 导出评分台账 Excel
 * 格式：标题行 + 两级表头（维度名 / 子项名）+ 数据行 + 总分/等级列
 * 完全匹配原始评分台账的列布局
 */
function exportScoreExcel() {
    if (scoreData.length === 0) {
        showToast('暂无评分数据可导出，请先完成评分', 'warning');
        return;
    }

    const rows = [];

    // 第1行：台账标题（54列，对应原始台账的A~BB列）
    const totalCols = 1 + MUST_ITEMS.length + SCORE_DIMENSIONS.reduce((s, d) => s + d.items.length, 0) + 2;
    rows.push(['民宿评分台账', ...Array(totalCols - 1).fill('')]);

    // 第2行：一级表头（维度名）
    const headerRow1 = ['民宿名称'];
    // 必备项（合并为一格）
    headerRow1.push('必备项（一票否决）', ...Array(MUST_ITEMS.length - 1).fill(''));
    // 各评分维度
    SCORE_DIMENSIONS.forEach(dim => {
        headerRow1.push(dim.name, ...Array(dim.items.length - 1).fill(''));
    });
    headerRow1.push('总分', '等级');
    rows.push(headerRow1);

    // 第3行：二级表头（子项名）
    const headerRow2 = [''];
    MUST_ITEMS.forEach(item => headerRow2.push(item.id));
    SCORE_DIMENSIONS.forEach(dim => {
        dim.items.forEach(item => headerRow2.push(item));
    });
    headerRow2.push('', '');
    rows.push(headerRow2);

    // 数据行（每个民宿一行）
    scoreData.forEach(entry => {
        const row = [entry.name];

        // 必备项：勾选为"✓"，未勾选为"✗"
        MUST_ITEMS.forEach(mustItem => {
            row.push(entry.mustChecks && entry.mustChecks[mustItem.id] ? '✓' : '✗');
        });

        // 各维度子项分数
        SCORE_DIMENSIONS.forEach(dim => {
            const dimData = entry.dimensions && entry.dimensions[dim.id];
            dim.items.forEach((_, i) => {
                const score = (dimData && dimData.items && dimData.items[i])
                    ? dimData.items[i].score
                    : '';
                row.push(score || '');
            });
        });

        // 总分 + 等级
        row.push(entry.totalScore || '');
        row.push(entry.grade || '');
        rows.push(row);
    });

    // 创建工作表
    const ws = XLSX.utils.aoa_to_sheet(rows);

    // 设置合并单元格（必备项 + 各维度一级表头 + 总分/等级）
    const merges = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },  // 标题行
        { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } },                // 民宿名称（纵跨2行）
    ];

    // 必备项合并（第2行）
    const mustStartCol = 1;
    const mustEndCol = MUST_ITEMS.length;
    merges.push({ s: { r: 1, c: mustStartCol }, e: { r: 1, c: mustEndCol } });

    // 各评分维度合并
    let colOffset = mustEndCol + 1;
    SCORE_DIMENSIONS.forEach(dim => {
        const endCol = colOffset + dim.items.length - 1;
        merges.push({ s: { r: 1, c: colOffset }, e: { r: 1, c: endCol } });
        colOffset = endCol + 1;
    });

    // 总分和等级合并（纵跨2行）
    const totalCol = colOffset;
    const gradeCol = colOffset + 1;
    merges.push({ s: { r: 1, c: totalCol }, e: { r: 2, c: totalCol } });
    merges.push({ s: { r: 1, c: gradeCol }, e: { r: 2, c: gradeCol } });

    ws['!merges'] = merges;

    // 设置列宽
    const colWidths = [{ wch: 18 }]; // 民宿名称
    MUST_ITEMS.forEach(() => colWidths.push({ wch: 8 }));
    SCORE_DIMENSIONS.forEach(dim => {
        dim.items.forEach(() => colWidths.push({ wch: 7 }));
    });
    colWidths.push({ wch: 8 }, { wch: 10 }); // 总分, 等级
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '民宿评分台账');

    const timestamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `民宿评分台账_导出_${timestamp}.xlsx`);
    showToast('✅ 评分台账已导出', 'success');
}

/**
 * 一键导出两个台账（打包为一个Excel的两个Sheet）
 */
function exportAllExcel() {
    if (basicData.length === 0 && scoreData.length === 0) {
        showToast('暂无数据可导出，请先填写信息', 'warning');
        return;
    }

    const wb = XLSX.utils.book_new();

    // Sheet1: 基本信息台账
    if (basicData.length > 0) {
        const rows1 = [];
        rows1.push(['民宿基本信息台账', '', '', '', '', '', '', '', '', '', '']);
        rows1.push(['民宿名称', '地址', '业主', '联系方式', '房间数', '开业时间', '特色', '人均价格', '停车场配套情况', '餐饮配套情况', '备注']);
        basicData.forEach(item => {
            rows1.push([
                item.name || '', item.address || '', item.owner || '',
                item.phone || '', item.rooms || '', item.openingPeriod || '',
                item.feature || '', item.avgPrice || '', item.parking || '',
                item.dining || '', item.remark || ''
            ]);
        });
        const ws1 = XLSX.utils.aoa_to_sheet(rows1);
        ws1['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 10 } }];
        ws1['!cols'] = [
            { wch: 18 }, { wch: 30 }, { wch: 10 }, { wch: 14 }, { wch: 8 },
            { wch: 10 }, { wch: 20 }, { wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 25 }
        ];
        XLSX.utils.book_append_sheet(wb, ws1, '民宿信息台账');
    }

    // Sheet2: 评分台账
    if (scoreData.length > 0) {
        const totalCols2 = 1 + MUST_ITEMS.length + SCORE_DIMENSIONS.reduce((s, d) => s + d.items.length, 0) + 2;
        const rows2 = [];
        rows2.push(['民宿评分台账', ...Array(totalCols2 - 1).fill('')]);

        const hRow1 = ['民宿名称'];
        hRow1.push('必备项（不计入总分）', ...Array(MUST_ITEMS.length - 1).fill(''));
        SCORE_DIMENSIONS.forEach(dim => { hRow1.push(dim.name, ...Array(dim.items.length - 1).fill('')); });
        hRow1.push('总分', '等级');
        rows2.push(hRow1);

        const hRow2 = [''];
        MUST_ITEMS.forEach(item => hRow2.push(item.id));
        SCORE_DIMENSIONS.forEach(dim => { dim.items.forEach(item => hRow2.push(item)); });
        hRow2.push('', '');
        rows2.push(hRow2);

        scoreData.forEach(entry => {
            const row = [entry.name];
            MUST_ITEMS.forEach(m => row.push(entry.mustChecks && entry.mustChecks[m.id] ? '✓' : '✗'));
            SCORE_DIMENSIONS.forEach(dim => {
                const dimData = entry.dimensions && entry.dimensions[dim.id];
                dim.items.forEach((_, i) => {
                    row.push((dimData && dimData.items && dimData.items[i]) ? dimData.items[i].score : '');
                });
            });
            row.push(entry.totalScore || '', entry.grade || '');
            rows2.push(row);
        });

        const ws2 = XLSX.utils.aoa_to_sheet(rows2);
        const merges2 = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols2 - 1 } },
            { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } },
        ];
        const mustStart2 = 1, mustEnd2 = MUST_ITEMS.length;
        merges2.push({ s: { r: 1, c: mustStart2 }, e: { r: 1, c: mustEnd2 } });
        let co = mustEnd2 + 1;
        SCORE_DIMENSIONS.forEach(dim => {
            const ec = co + dim.items.length - 1;
            merges2.push({ s: { r: 1, c: co }, e: { r: 1, c: ec } });
            co = ec + 1;
        });
        merges2.push({ s: { r: 1, c: co }, e: { r: 2, c: co } });
        merges2.push({ s: { r: 1, c: co + 1 }, e: { r: 2, c: co + 1 } });
        ws2['!merges'] = merges2;

        const cw2 = [{ wch: 18 }];
        MUST_ITEMS.forEach(() => cw2.push({ wch: 8 }));
        SCORE_DIMENSIONS.forEach(dim => { dim.items.forEach(() => cw2.push({ wch: 7 })); });
        cw2.push({ wch: 8 }, { wch: 10 });
        ws2['!cols'] = cw2;

        XLSX.utils.book_append_sheet(wb, ws2, '民宿评分台账');
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `民宿台账_完整导出_${timestamp}.xlsx`);
    showToast('✅ 两个台账已合并导出为同一Excel文件', 'success');
}

/* ============================================================
   八、ECharts 可视化图表模块
   ============================================================ */

/** 存储ECharts实例引用，用于resize */
const chartInstances = {};

/**
 * 初始化/刷新所有图表
 */
function refreshAllCharts() {
    renderChartOpeningPeriod();
    renderChartGradePie();
    renderChartFacilityBar();
    renderChartRadar();
}

/**
 * 图1：各开业年限民宿数量柱状图
 */
function renderChartOpeningPeriod() {
    const dom = document.getElementById('chartOpeningPeriod');
    if (!dom) return;

    // 统计各开业年限的数量
    const periods = ['1年以内', '1-3年', '3-5年', '5年以上'];
    const counts = periods.map(p => basicData.filter(item => item.openingPeriod === p).length);

    // 初始化或更新
    if (!chartInstances.openingPeriod) {
        chartInstances.openingPeriod = echarts.init(dom);
    }
    const chart = chartInstances.openingPeriod;

    chart.setOption({
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' }
        },
        grid: {
            left: '8%',
            right: '8%',
            bottom: '8%',
            top: '10%',
            containLabel: true
        },
        xAxis: {
            type: 'category',
            data: periods,
            axisLabel: { fontSize: 12 },
            axisTick: { alignWithLabel: true }
        },
        yAxis: {
            type: 'value',
            name: '数量（家）',
            minInterval: 1,
            axisLabel: { fontSize: 12 }
        },
        series: [{
            name: '民宿数量',
            type: 'bar',
            data: counts,
            itemStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: '#3b82f6' },
                    { offset: 1, color: '#2563eb' }
                ]),
                borderRadius: [8, 8, 0, 0]
            },
            barWidth: '50%',
            label: {
                show: true,
                position: 'top',
                fontSize: 14,
                fontWeight: 'bold',
                color: '#1e293b'
            }
        }]
    }, true);
}

/**
 * 图2：各评分等级民宿占比饼图
 */
function renderChartGradePie() {
    const dom = document.getElementById('chartGradePie');
    if (!dom) return;

    // 统计各等级数量
    const grades = ['永汉金宿', '永汉银宿', '永汉铜宿', '不定级'];
    const gradeColors = ['#f59e0b', '#94a3b8', '#b45309', '#dc2626'];
    const counts = grades.map(g => scoreData.filter(s => s.grade === g).length);

    // 只统计有评分的
    const totalScored = counts.reduce((a, b) => a + b, 0);

    if (!chartInstances.gradePie) {
        chartInstances.gradePie = echarts.init(dom);
    }
    const chart = chartInstances.gradePie;

    if (totalScored === 0) {
        chart.setOption({
            title: {
                text: '暂无评分数据',
                left: 'center',
                top: 'center',
                textStyle: { color: '#94a3b8', fontSize: 14 }
            }
        }, true);
        return;
    }

    const pieData = grades.map((g, i) => ({
        name: g,
        value: counts[i]
    })).filter(d => d.value > 0);

    chart.setOption({
        tooltip: {
            trigger: 'item',
            formatter: '{b}: {c} 家 ({d}%)'
        },
        legend: {
            orient: 'horizontal',
            bottom: 0,
            textStyle: { fontSize: 11 }
        },
        series: [{
            name: '评分等级',
            type: 'pie',
            radius: ['45%', '75%'],
            center: ['50%', '45%'],
            avoidLabelOverlap: false,
            itemStyle: {
                borderRadius: 6,
                borderColor: '#fff',
                borderWidth: 2
            },
            label: {
                show: true,
                formatter: '{b}\n{d}%',
                fontSize: 11
            },
            emphasis: {
                label: { fontSize: 16, fontWeight: 'bold' }
            },
            data: pieData,
            color: gradeColors.slice(0, pieData.length)
        }]
    }, true);
}

/**
 * 图3：停车场 / 餐饮配套类型民宿占比（堆叠条形图）
 */
function renderChartFacilityBar() {
    const dom = document.getElementById('chartFacilityBar');
    if (!dom) return;

    // 统计停车场类型
    const parkingTypes = ['自有免费停车场', '自有收费停车场', '路边免费停车位', '无停车位'];
    const parkingCounts = parkingTypes.map(p => basicData.filter(item => item.parking === p).length);

    // 统计餐饮类型
    const diningTypes = ['配套自营餐厅', '合作农家菜', '无餐饮配套'];
    const diningCounts = diningTypes.map(d => basicData.filter(item => item.dining === d).length);

    if (!chartInstances.facilityBar) {
        chartInstances.facilityBar = echarts.init(dom);
    }
    const chart = chartInstances.facilityBar;

    chart.setOption({
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' }
        },
        legend: {
            data: ['停车场配套', '餐饮配套'],
            bottom: 0,
            textStyle: { fontSize: 11 }
        },
        grid: {
            left: '3%',
            right: '12%',
            bottom: '12%',
            top: '5%',
            containLabel: true
        },
        xAxis: {
            type: 'value',
            minInterval: 1,
            axisLabel: { fontSize: 11 }
        },
        yAxis: {
            type: 'category',
            data: ['自有免费停车场', '自有收费停车场', '路边免费停车位', '无停车位']
        },
        series: [
            {
                name: '停车场配套',
                type: 'bar',
                data: parkingCounts.map((v, i) => ({
                    value: v,
                    itemStyle: { color: '#3b82f6' }
                })),
                barGap: '10%',
                label: { show: true, position: 'right', fontSize: 11 }
            },
            {
                name: '餐饮配套',
                type: 'bar',
                data: [
                    basicData.filter(item => item.dining === '配套自营餐厅').length,
                    basicData.filter(item => item.dining === '合作农家菜').length,
                    basicData.filter(item => item.dining === '无餐饮配套').length,
                    0 // 第4个停车类型没有对应的餐饮数据
                ],
                itemStyle: { color: '#f97316' },
                label: { show: true, position: 'right', fontSize: 11 }
            }
        ]
    }, true);
}

/**
 * 图4：6个评分维度平均得分对比雷达图
 */
function renderChartRadar() {
    const dom = document.getElementById('chartRadar');
    if (!dom) return;

    if (!chartInstances.radar) {
        chartInstances.radar = echarts.init(dom);
    }
    const chart = chartInstances.radar;

    if (scoreData.length === 0) {
        chart.setOption({
            title: {
                text: '暂无评分数据',
                left: 'center',
                top: 'center',
                textStyle: { color: '#94a3b8', fontSize: 14 }
            }
        }, true);
        return;
    }

    // 计算各维度平均得分（归一化为百分制占比）
    const indicators = SCORE_DIMENSIONS.map(dim => ({
        name: dim.name,
        max: 100
    }));

    const avgScores = SCORE_DIMENSIONS.map(dim => {
        const allScores = scoreData.map(entry => {
            const dimData = entry.dimensions && entry.dimensions[dim.id];
            return dimData ? dimData.subtotal : 0;
        });
        const sum = allScores.reduce((a, b) => a + b, 0);
        // 转换为百分制（实际得分/维度上限*100）
        const avgRaw = sum / allScores.length;
        const pct = Math.round((avgRaw / dim.maxScore) * 100);
        return pct;
    });

    chart.setOption({
        tooltip: {
            trigger: 'item'
        },
        radar: {
            center: ['50%', '50%'],
            radius: '65%',
            indicator: indicators,
            axisName: {
                fontSize: 11,
                color: '#475569'
            }
        },
        series: [{
            name: '评分维度平均得分',
            type: 'radar',
            data: [{
                value: avgScores,
                name: '平均得分率(%)',
                areaStyle: {
                    color: 'rgba(37, 99, 235, 0.2)'
                },
                lineStyle: {
                    color: '#2563eb',
                    width: 2
                },
                itemStyle: {
                    color: '#2563eb'
                }
            }],
            symbol: 'circle',
            symbolSize: 6
        }]
    }, true);
}

/* ============================================================
   九、右侧预览面板刷新
   ============================================================ */

/**
 * 刷新右侧预览统计卡片
 */
function refreshPreviewStats() {
    const total = basicData.length;
    document.getElementById('statTotal').textContent = total;

    // 平均评分
    if (scoreData.length > 0) {
        const avgScore = scoreData.reduce((sum, s) => sum + s.totalScore, 0) / scoreData.length;
        document.getElementById('statAvgScore').textContent = Math.round(avgScore * 10) / 10;
    } else {
        document.getElementById('statAvgScore').textContent = '--';
    }

    // 优秀数量
    const excellentCount = scoreData.filter(s => s.totalScore >= 90).length;
    document.getElementById('statExcellent').textContent = excellentCount;

    // 待改进数量（<70分，含不合格）
    const failCount = scoreData.filter(s => s.totalScore < 70).length;
    document.getElementById('statFail').textContent = failCount;

    // 最新录入预览
    const latestEl = document.getElementById('latestEntry');
    if (basicData.length === 0) {
        latestEl.innerHTML = '<p class="muted-text">暂无录入数据，填写左侧表单开始...</p>';
    } else {
        const latest = basicData[basicData.length - 1];
        const homestayScores = scoreData.filter(s => s.name === latest.name);
        const scoreEntry = homestayScores.length > 0 ? homestayScores[homestayScores.length - 1] : null;
        latestEl.innerHTML = `
            <div style="font-weight:700;margin-bottom:6px;">📌 最新录入</div>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:0.82rem;">
                <span style="color:var(--color-text-muted);">名称</span><span><strong>${escapeHtml(latest.name)}</strong></span>
                <span style="color:var(--color-text-muted);">地址</span><span>${escapeHtml(latest.address || '--')}</span>
                <span style="color:var(--color-text-muted);">业主</span><span>${escapeHtml(latest.owner || '--')}</span>
                <span style="color:var(--color-text-muted);">房间</span><span>${latest.rooms || '--'} 间</span>
                <span style="color:var(--color-text-muted);">评分</span><span>${scoreEntry ? scoreEntry.totalScore + '分 / ' + scoreEntry.grade : '未评分'}</span>
            </div>
        `;
    }
}

/* ============================================================
   十、全局刷新（联动所有模块）
   ============================================================ */

/**
 * 刷新页面所有组件：列表、预览、图表、评分下拉
 */
function refreshAll() {
    refreshDataList();           // 民宿列表
    refreshScoreTargetSelect();  // 评分下拉
    refreshPreviewStats();       // 预览统计
    refreshAllCharts();          // 可视化图表
    updateBasicProgress();       // 基础信息进度
    document.getElementById('dataCount').textContent = `已录入：${basicData.length} 家民宿`;
}

/* ============================================================
   十一、重置功能
   ============================================================ */

/**
 * 重置所有数据（清空localStorage + 页面状态）
 */
function resetAllData() {
    if (!confirm('⚠ 确定要清空所有数据吗？\n\n此操作将删除所有民宿基础信息、评分数据，且无法恢复！\n\n建议先导出Excel备份数据。')) {
        return;
    }

    // 二次确认
    if (!confirm('再次确认：真的要清空全部数据吗？')) {
        return;
    }

    basicData = [];
    scoreData = [];
    localStorage.removeItem(STORAGE_KEY_BASIC);
    localStorage.removeItem(STORAGE_KEY_SCORE);
    clearBasicForm();
    clearScoringForm();
    refreshAll();
    showToast('🔄 所有数据已清空', 'warning');
}

/* ============================================================
   十二、窗口resize监听（ECharts自适应）
   ============================================================ */

// 防抖：避免频繁触发
let resizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        Object.values(chartInstances).forEach(chart => {
            try { chart.resize(); } catch (e) { /* ignore */ }
        });
    }, 200);
});

/* ============================================================
   十三、初始化（DOMContentLoaded）
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🏡 永汉镇温泉民宿星级评定系统 初始化中...');

    // ---------- 0. 首次访问弹出使用说明（sessionStorage控制，仅本次会话一次）----------
    if (!sessionStorage.getItem('yonghan_guide_shown')) {
        showGuideModal();
        sessionStorage.setItem('yonghan_guide_shown', '1');
    }

    // ---------- 1. 初始化Supabase并加载云端数据 ----------
    initSupabase();

    // ---------- 1. 渲染评分表单子项 ----------
    renderScoringForm();

    // ---------- 2. 从云端拉取全量数据（覆盖本地缓存，实现多人数据互通）----------
    await loadCloudAllData();

    // ---------- 3. 标签切换 ----------
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const targetTab = this.dataset.tab;

            // 切换标签激活状态
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            // 切换面板显示
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            const targetPanel = document.getElementById(targetTab);
            if (targetPanel) targetPanel.classList.add('active');

            // 切换到列表标签时刷新列表
            if (targetTab === 'tab-list') refreshDataList();
            // 切换到评分标签时刷新下拉和清除编辑状态
            if (targetTab === 'tab-scoring') {
                refreshScoreTargetSelect();
                // 若不在编辑模式，恢复正常状态
                const nameInput = document.getElementById('name');
                if (nameInput.readOnly) {
                    nameInput.readOnly = false;
                    nameInput.style.background = '';
                    document.querySelector('label[for="name"] .label-tip').textContent = '（不可重复）';
                }
            }

            // 切换标签后延迟resize图表
            setTimeout(() => {
                Object.values(chartInstances).forEach(c => { try { c.resize(); } catch (e) {} });
            }, 300);
        });
    });

    // ---------- 4. 基础信息表单事件 ----------
    const nameInput = document.getElementById('name');
    nameInput.addEventListener('input', checkNameUnique);
    nameInput.addEventListener('blur', checkNameUnique);

    // 必填项进度实时更新
    document.querySelectorAll('#formBasic input[required], #formBasic select[required]').forEach(el => {
        el.addEventListener('input', updateBasicProgress);
        el.addEventListener('change', updateBasicProgress);
    });

    // 手机号实时格式限制（只允许数字）
    document.getElementById('phone').addEventListener('input', function() {
        this.value = this.value.replace(/\D/g, '').slice(0, 11);
    });

    // 房间数只允许正整数
    document.getElementById('rooms').addEventListener('input', function() {
        this.value = this.value.replace(/\D/g, '');
    });

    // 保存按钮
    document.getElementById('btnSaveBasic').addEventListener('click', saveBasicInfo);

    // 清空按钮
    document.getElementById('btnClearBasic').addEventListener('click', () => {
        // 如果在编辑模式，恢复name可编辑
        const nameInput = document.getElementById('name');
        if (nameInput.readOnly) {
            nameInput.readOnly = false;
            nameInput.style.background = '';
            document.querySelector('label[for="name"] .label-tip').textContent = '（不可重复）';
        }
        clearBasicForm();
        showToast('表单已清空', 'info');
    });

    // ---------- 5. 评分表单事件 ----------
    document.getElementById('btnSaveScore').addEventListener('click', saveScoringData);
    document.getElementById('btnClearScore').addEventListener('click', () => {
        clearScoringForm();
        showToast('评分表单已清空', 'info');
    });
    document.getElementById('scoreTarget').addEventListener('change', onScoreTargetChange);

    // ---------- 6. 导出按钮 ----------
    document.getElementById('btnExport').addEventListener('click', () => {
        // 弹出导出选项
        const choice = confirm(
            '请选择导出方式：\n\n' +
            '点击「确定」→ 合并导出（两个台账在一个Excel文件中）\n' +
            '点击「取消」→ 分别导出（两个独立Excel文件）'
        );
        if (choice) {
            exportAllExcel();
        } else {
            exportBasicExcel();
            // 延迟避免同时弹下载
            setTimeout(() => {
                if (scoreData.length > 0) exportScoreExcel();
            }, 500);
        }
    });

    // ---------- 7. 重置按钮 ----------
    document.getElementById('btnReset').addEventListener('click', resetAllData);

    // ---------- 8. 列表搜索 ----------
    const listSearch = document.getElementById('listSearch');
    if (listSearch) {
        listSearch.addEventListener('input', refreshDataList);
    }

    // ---------- 9. 初始刷新（使用云端数据渲染全部组件）----------
    refreshAll();

    console.log('✅ 系统初始化完成！');
    console.log(`   - 已加载 ${basicData.length} 条基础信息`);
    console.log(`   - 已加载 ${scoreData.length} 条评分数据`);
    console.log('💡 提示：数据自动保存在浏览器本地存储中，刷新页面不丢失。');

    /* ============================================================
       十四、外部调用接口（供WorkBuddy等自动化工具使用）
       以下接口挂载到 window 全局
       ============================================================ */

    /**
     * [接口] 获取所有民宿数据（基础+评分合并）
     * @returns {{ basic: Array, score: Array, merged: Array }}
     */
    window.getHomestayData = function() {
        const merged = basicData.map(basic => {
            const scores = scoreData.filter(s => s.name === basic.name);
            const avgScore = scores.length > 0 ? Math.round(scores.reduce((s, r) => s + r.totalScore, 0) / scores.length * 10) / 10 : null;
            return { ...basic, scores, scoreCount: scores.length, avgScore };
        });
        return { basic: basicData, score: scoreData, merged };
    };

    /**
     * [接口] 批量导入民宿数据（JSON格式），自动去重
     * @param {{ basic?: Array, score?: Array }} importData
     * @returns {{ success: boolean, message: string }}
     */
    window.importHomestayData = function(importData) {
        try {
            if (importData.basic && Array.isArray(importData.basic)) {
                const existingNames = new Set(basicData.map(b => b.name));
                const newItems = importData.basic.filter(b => !existingNames.has(b.name));
                basicData = [...basicData, ...newItems];
                saveData(STORAGE_KEY_BASIC, basicData);
            }
            if (importData.score && Array.isArray(importData.score)) {
                // 允许同一民宿多条评分，直接全部追加
                scoreData = [...scoreData, ...importData.score];
                saveData(STORAGE_KEY_SCORE, scoreData);
            }
            refreshAll();
            return { success: true, message: `导入成功：${importData.basic?.length || 0}条基础信息，${importData.score?.length || 0}条评分` };
        } catch (e) {
            return { success: false, message: '导入失败：' + e.message };
        }
    };

    /**
     * [接口] 导出完整数据为JSON字符串（供WorkBuddy读取）
     * @returns {string} JSON字符串
     */
    window.exportToJSON = function() {
        return JSON.stringify({
            version: '1.0',
            exportTime: new Date().toISOString(),
            basic: basicData,
            score: scoreData,
            dimensions: SCORE_DIMENSIONS,
            mustItems: MUST_ITEMS
        }, null, 2);
    };

/**
 * [需求2] 首次打开页面弹出使用说明模态弹窗
 * sessionStorage 控制：仅本次浏览器会话首次打开弹出
 */
function showGuideModal() {
    // 移除旧弹窗（如果有）
    const old = document.getElementById('guideModal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'guideModal';
    modal.className = 'guide-modal-overlay';
    modal.innerHTML = `
        <div class="guide-modal-card">
            <h2 class="guide-modal-title">🏡 永汉镇温泉民宿星级评定系统</h2>
            <div class="guide-modal-body">
                <div class="guide-section">
                    <span class="guide-num">①</span>
                    <span>本系统用于<strong>永汉镇温泉民宿星级评定</strong>，数据自动同步Supabase云端，<strong>多人填报互通</strong>。</span>
                </div>
                <div class="guide-section">
                    <span class="guide-num">②</span>
                    <span>先填写<strong>民宿基础信息</strong>，再完成<strong>18项必备项勾选</strong>（任意一项不达标直接"不定级"）。</span>
                </div>
                <div class="guide-section">
                    <span class="guide-num">③</span>
                    <span>各评分小项<strong>有分值上限</strong>（如1.3温泉供应上限5分），填写超出会自动修正。</span>
                </div>
                <div class="guide-section">
                    <span class="guide-num">④</span>
                    <span>同民宿可<strong>多人多次评分</strong>，数据永久保存在云端，系统自动计算平均分。</span>
                </div>
                <div class="guide-section">
                    <span class="guide-num">⑤</span>
                    <span>填写中途可<strong>保存草稿</strong>，支持一键<strong>导出Excel</strong>完整台账。</span>
                </div>
                <div class="guide-section">
                    <span class="guide-num">⑥</span>
                    <span>链接访问不稳定建议<strong>切换浏览器</strong>、<strong>Ctrl+F5</strong>强制刷新。</span>
                </div>
            </div>
            <div class="guide-modal-footer">
                <button class="btn btn-primary guide-confirm-btn" id="btnGuideConfirm">
                    ✅ 我已知晓，开始评定
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // 关闭事件
    const closeModal = () => {
        modal.classList.add('guide-modal-closing');
        setTimeout(() => modal.remove(), 300);
    };

    document.getElementById('btnGuideConfirm').addEventListener('click', closeModal);
    // 点击遮罩也可关闭
    modal.addEventListener('click', function(e) {
        if (e.target === modal) closeModal();
    });
    // ESC 关闭
    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); }
    });
}

console.log('🔌 外部接口已就绪：');
    console.log('🔌 外部接口已就绪：');
    console.log('   window.getHomestayData()      - 获取全部数据');
    console.log('   window.importHomestayData({}) - 批量导入数据');
    console.log('   window.exportToJSON()         - 导出JSON');
});
