/* ============================================================
   民宿信息收集+评分填报系统 - 主逻辑脚本
   功能：
     1. 民宿基础信息 增/删/改/查 + 表单校验 + 名称去重
     2. 民宿服务质量评分 7大维度实时计算 + 自动评级
     3. localStorage 本地持久化存储
     4. 一键导出 Excel（完全匹配原始台账格式）
     5. ECharts 实时可视化（柱状图/饼图/雷达图/条形图）
     6. 预留 WorkBuddy / 金山文档 数据同步接口

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

/**
 * 6个评分维度的配置
 * 每个维度包含：id, name, maxScore（该维度总分上限）, items（子项列表）
 * 总分 = 各维度 maxScore 之和 = 20+20+15+20+10+15 = 100
 */
const SCORE_DIMENSIONS = [
    {
        id: 'infra',            // 维度ID
        name: '基础设施',        // 维度名称
        maxScore: 20,           // 维度分值上限
        items: [
            '交通便利性',
            '建筑外观与周边协调',
            '温泉水供应稳定性',
            '客房基础配置',
            '公共配套',
            '无障碍与适老'
        ]
    },
    {
        id: 'service',
        name: '服务质量',
        maxScore: 20,
        items: [
            '主人/管家参与接待',
            '接待人员仪容礼仪',
            '业务熟练度',
            '服务响应',
            '特色服务供给',
            '投诉处理闭环'
        ]
    },
    {
        id: 'hygiene',
        name: '环境卫生',
        maxScore: 15,
        items: [
            '布草每客必换',
            '客房/公区整洁',
            '私汤泡池卫生',
            '卫生间防潮通风',
            '防虫防蛇防鼠'
        ]
    },
    {
        id: 'safety',
        name: '安全管理',
        maxScore: 20,
        items: [
            '安全警示标识',
            '消防合规',
            '预案+演练',
            '监控覆盖',
            '食品安全（若供餐）',
            '公众责任险'
        ]
    },
    {
        id: 'culture',
        name: '文化特色',
        maxScore: 10,
        items: [
            '建筑/装修地域性',
            '本地体验项目',
            '文创/特产带动',
            '社区贡献'
        ]
    },
    {
        id: 'facility',
        name: '设施设备',
        maxScore: 15,
        items: [
            '客房家具品质',
            '布草间独立整洁',
            '消洗区独立',
            '网络与智能',
            '休闲设施',
            '维保记录'
        ]
    }
];

/** 必备项清单（不计分，仅核查） */
const MUST_ITEMS = [
    '证照齐全合法经营',
    '正式开业≥1年',
    '建筑规模合规',
    '治安/环保/安全合规',
    '温泉水源可溯源',
    '安全警示标识',
    '危化品管理',
    '安全制度+预案+演练',
    '食品合规（若供餐）',
    '卫生达标',
    '生活用水达标',
    '装修用材合规',
    '从业人员持证',
    '垃圾分类+污水',
    '服务明码标价',
    '进入性良好',
    '建筑外观协调',
    '公众责任险'
];

/**
 * 评分等级映射
 * @param {number} score - 总分
 * @returns {{ grade: string, cssClass: string }} 等级名称和CSS类名
 */
function getGradeInfo(score) {
    if (score >= 90) return { grade: '优秀', cssClass: 'grade-excellent' };
    if (score >= 80) return { grade: '良好', cssClass: 'grade-good' };
    if (score >= 70) return { grade: '合格', cssClass: 'grade-pass' };
    if (score >= 60) return { grade: '待改进', cssClass: 'grade-improve' };
    return { grade: '不合格', cssClass: 'grade-fail' };
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

    saveData(STORAGE_KEY_BASIC, basicData);
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
        <div class="must-item">
            <input type="checkbox" id="must_${i}" data-must="${item}">
            <label for="must_${i}">${item}</label>
        </div>
    `).join('');

    // 2. 渲染6个评分维度
    SCORE_DIMENSIONS.forEach(dim => {
        const container = document.getElementById('score' + dim.id.charAt(0).toUpperCase() + dim.id.slice(1));
        if (!container) return;

        container.innerHTML = dim.items.map((item, i) => `
            <div class="score-item">
                <label for="score_${dim.id}_${i}">${item}</label>
                <input type="number"
                       id="score_${dim.id}_${i}"
                       min="0"
                       max="${dim.maxScore}"
                       step="0.5"
                       value=""
                       placeholder="0"
                       data-dim="${dim.id}"
                       data-index="${i}">
            </div>
        `).join('');
    });

    // 3. 绑定所有评分输入事件（实时计算）
    document.querySelectorAll('.score-grid input[type="number"]').forEach(input => {
        input.addEventListener('input', recalculateAllScores);
    });

    // 4. 绑定必备项checkbox事件
    document.querySelectorAll('.must-grid input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', updateScorePreview);
    });
}

/**
 * 获取某个维度的所有分数输入值
 * @param {string} dimId - 维度ID
 * @returns {number[]} 分数数组
 */
function getDimensionScores(dimId) {
    const inputs = document.querySelectorAll(`input[data-dim="${dimId}"]`);
    return Array.from(inputs).map(inp => {
        const val = parseFloat(inp.value);
        return isNaN(val) || val < 0 ? 0 : val;
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
    document.querySelectorAll('.must-grid input[type="checkbox"]').forEach(cb => {
        mustChecks[cb.dataset.must] = cb.checked;
    });

    // 收集各维度分数
    const dimensions = {};
    let totalScore = 0;
    SCORE_DIMENSIONS.forEach(dim => {
        const scores = getDimensionScores(dim.id);
        const subtotal = scores.reduce((sum, s) => sum + s, 0);
        dimensions[dim.id] = {
            name: dim.name,
            maxScore: dim.maxScore,
            items: dim.items.map((item, i) => ({ name: item, score: scores[i] })),
            subtotal: Math.min(subtotal, dim.maxScore)
        };
        totalScore += Math.min(subtotal, dim.maxScore);
    });

    const gradeInfo = getGradeInfo(totalScore);

    return {
        name: target,
        mustChecks,
        dimensions,
        totalScore: Math.round(totalScore * 10) / 10,
        grade: gradeInfo.grade,
        updatedAt: new Date().toISOString()
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

    // 更新评级
    const gradeInfo = getGradeInfo(roundedTotal);
    const gradeEl = document.getElementById('totalGrade');
    gradeEl.textContent = gradeInfo.grade;
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

    previewEl.innerHTML = `
        <div style="font-weight:700;margin-bottom:8px;">📝 当前评分预览：${data.name}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:0.82rem;">
            ${SCORE_DIMENSIONS.map(dim => {
                const d = data.dimensions[dim.id];
                const pct = Math.round((d.subtotal / dim.maxScore) * 100);
                return `<span>${dim.name}</span><span style="color:var(--color-primary);font-weight:600;">${d.subtotal.toFixed(1)}/${dim.maxScore} (${pct}%)</span>`;
            }).join('')}
            <span style="font-weight:700;">总分</span><span style="font-weight:800;color:var(--color-primary);">${data.totalScore.toFixed(1)}/100</span>
            <span>必备项核查</span><span>${mustChecked}/${mustTotal} 项通过</span>
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

    // 检查是否已有该民宿的评分记录
    if (target) {
        const existing = scoreData.find(s => s.name === target);
        if (existing) {
            // 允许覆盖，但提示
            // errors.push(`「${target}」已有评分记录，将覆盖旧数据`);
        }
    }

    const data = getScoringFormData();
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

    // 检查是否已存在该民宿评分记录
    const existingIndex = scoreData.findIndex(s => s.name === data.name);
    if (existingIndex >= 0) {
        if (!confirm(`「${data.name}」已有评分记录（${scoreData[existingIndex].totalScore}分/${scoreData[existingIndex].grade}），是否覆盖？`)) {
            return;
        }
        scoreData[existingIndex] = data;
    } else {
        scoreData.push(data);
    }

    saveData(STORAGE_KEY_SCORE, scoreData);
    showToast(`✅ 已保存「${data.name}」的评分（${data.totalScore}分/${data.grade}）`, 'success');
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

    // 获取已有评分记录的民宿名称
    const scoredNames = new Set(scoreData.map(s => s.name));

    select.innerHTML = '<option value="">-- 请先选择民宿 --</option>'
        + basicData.map((item, i) => {
            const scored = scoredNames.has(item.name);
            return `<option value="${item.name}">
                ${item.name}${scored ? ' (已有评分)' : ''}
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

    // 查找已有评分记录并回填
    const existing = scoreData.find(s => s.name === target);
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
        // 查找该民宿的评分
        const scoreEntry = scoreData.find(s => s.name === item.name);
        const scoreDisplay = scoreEntry
            ? `${scoreEntry.totalScore}分`
            : '<span style="color:var(--color-text-muted);">未评分</span>';
        const gradeDisplay = scoreEntry
            ? `<span class="grade-badge ${getGradeInfo(scoreEntry.totalScore).cssClass}">${scoreEntry.grade}</span>`
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

    saveData(STORAGE_KEY_BASIC, basicData);
    saveData(STORAGE_KEY_SCORE, scoreData);
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
    headerRow1.push('必备项（不计入总分）', ...Array(MUST_ITEMS.length - 1).fill(''));
    // 各评分维度
    SCORE_DIMENSIONS.forEach(dim => {
        headerRow1.push(dim.name, ...Array(dim.items.length - 1).fill(''));
    });
    headerRow1.push('总分', '等级');
    rows.push(headerRow1);

    // 第3行：二级表头（子项名）
    const headerRow2 = [''];
    MUST_ITEMS.forEach(item => headerRow2.push(item));
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
            row.push(entry.mustChecks && entry.mustChecks[mustItem] ? '✓' : '');
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
        MUST_ITEMS.forEach(item => hRow2.push(item));
        SCORE_DIMENSIONS.forEach(dim => { dim.items.forEach(item => hRow2.push(item)); });
        hRow2.push('', '');
        rows2.push(hRow2);

        scoreData.forEach(entry => {
            const row = [entry.name];
            MUST_ITEMS.forEach(m => row.push(entry.mustChecks && entry.mustChecks[m] ? '✓' : ''));
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
    const grades = ['优秀', '良好', '合格', '待改进', '不合格'];
    const gradeColors = ['#16a34a', '#2563eb', '#d97706', '#f97316', '#dc2626'];
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
        const scoreEntry = scoreData.find(s => s.name === latest.name);
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

document.addEventListener('DOMContentLoaded', () => {
    console.log('🏡 民宿信息收集+评分填报系统 初始化中...');

    // ---------- 0. 渲染评分表单子项 ----------
    renderScoringForm();

    // ---------- 1. 标签切换 ----------
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

    // ---------- 2. 基础信息表单事件 ----------
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

    // ---------- 3. 评分表单事件 ----------
    document.getElementById('btnSaveScore').addEventListener('click', saveScoringData);
    document.getElementById('btnClearScore').addEventListener('click', () => {
        clearScoringForm();
        showToast('评分表单已清空', 'info');
    });
    document.getElementById('scoreTarget').addEventListener('change', onScoreTargetChange);

    // ---------- 4. 导出按钮 ----------
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

    // ---------- 5. 重置按钮 ----------
    document.getElementById('btnReset').addEventListener('click', resetAllData);

    // ---------- 6. 列表搜索 ----------
    const listSearch = document.getElementById('listSearch');
    if (listSearch) {
        listSearch.addEventListener('input', refreshDataList);
    }

    // ---------- 7. 初始刷新 ----------
    refreshAll();

    console.log('✅ 系统初始化完成！');
    console.log(`   - 已加载 ${basicData.length} 条基础信息`);
    console.log(`   - 已加载 ${scoreData.length} 条评分数据`);
    console.log('💡 提示：数据自动保存在浏览器本地存储中，刷新页面不丢失。');

    /* ============================================================
       十四、预留接口（供WorkBuddy/金山文档等外部系统调用）
       以下接口挂载到 window 全局，方便外部脚本或自动化流程调用
       ============================================================ */

    /**
     * [预留接口] 获取所有民宿数据（基础+评分）
     * WorkBuddy 可通过此接口读取数据进行自动化分析
     * @returns {{ basic: Array, score: Array, merged: Array }}
     */
    window.getHomestayData = function() {
        // 合并基础信息与评分数据
        const merged = basicData.map(basic => {
            const score = scoreData.find(s => s.name === basic.name) || null;
            return { ...basic, score };
        });
        return { basic: basicData, score: scoreData, merged };
    };

    /**
     * [预留接口] 批量导入民宿数据（JSON格式）
     * 可用于从外部系统（如WorkBuddy导出结果）批量导入
     * @param {{ basic?: Array, score?: Array }} importData - 导入数据
     * @returns {{ success: boolean, message: string }}
     */
    window.importHomestayData = function(importData) {
        try {
            if (importData.basic && Array.isArray(importData.basic)) {
                // 去重处理
                const existingNames = new Set(basicData.map(b => b.name));
                const newItems = importData.basic.filter(b => !existingNames.has(b.name));
                basicData = [...basicData, ...newItems];
                saveData(STORAGE_KEY_BASIC, basicData);
            }
            if (importData.score && Array.isArray(importData.score)) {
                const existingScoreNames = new Set(scoreData.map(s => s.name));
                const newScores = importData.score.filter(s => !existingScoreNames.has(s.name));
                scoreData = [...scoreData, ...newScores];
                saveData(STORAGE_KEY_SCORE, scoreData);
            }
            refreshAll();
            return { success: true, message: `导入成功：${importData.basic?.length || 0}条基础信息，${importData.score?.length || 0}条评分` };
        } catch (e) {
            return { success: false, message: '导入失败：' + e.message };
        }
    };

    /**
     * [预留接口] 同步数据到金山文档在线表格
     * 当前为预留接口，后续配置API地址和Token后可启用
     * @param {string} apiUrl - 金山文档API地址
     * @param {string} token - 认证Token
     * @returns {Promise<{success: boolean, message: string}>}
     */
    window.syncToJinshanDoc = async function(apiUrl, token) {
        try {
            const payload = {
                basic: basicData,
                score: scoreData,
                exportTime: new Date().toISOString()
            };
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const result = await response.json();
            showToast('✅ 数据已同步到金山文档', 'success');
            return { success: true, message: '同步成功', data: result };
        } catch (e) {
            console.error('[金山文档同步失败]', e);
            showToast('❌ 同步失败：' + e.message, 'error');
            return { success: false, message: e.message };
        }
    };

    /**
     * [预留接口] 导出JSON数据（供WorkBuddy直接读取）
     * 返回完整的数据结构，方便自动化流程处理
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

    console.log('🔌 预留接口已就绪：');
    console.log('   window.getHomestayData()        - 获取全部数据');
    console.log('   window.importHomestayData({})   - 批量导入数据');
    console.log('   window.syncToJinshanDoc(url,tk) - 同步到金山文档');
    console.log('   window.exportToJSON()           - 导出JSON');
});
