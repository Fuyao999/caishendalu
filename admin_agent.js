// ============================================
// 代理系统管理后台 JS
// ============================================

// ===== 激活码管理 =====
async function loadActivationCodes() {
    const status = document.getElementById('acStatusFilter')?.value || '';
    try {
        const res = await fetch(`/api/agent/admin/codes${status ? '?status=' + status : ''}`, {
            credentials: 'include'
        });
        const data = await res.json();
        if (data.code === 0) {
            renderActivationCodesTable(data.data);
        }
    } catch (e) {
        console.error('加载激活码失败:', e);
    }
}

function renderActivationCodesTable(codes) {
    const tbody = document.getElementById('acTableBody');
    if (!tbody) return;
    
    if (!codes || codes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#888">暂无数据</td></tr>';
        return;
    }
    
    let html = '';
    for (const c of codes) {
        let statusBadge = '';
        if (c.status === 'unused') statusBadge = '<span class="badge badge-success">未使用</span>';
        else if (c.status === 'used') statusBadge = '<span class="badge badge-info">已使用</span>';
        else if (c.status === 'cancelled') statusBadge = '<span class="badge badge-danger">已作废</span>';
        
        let actionBtn = '';
        if (c.status === 'unused') {
            actionBtn = `<button class="btn btn-sm btn-danger" onclick="cancelActivationCode(${c.id})">作废</button>`;
        } else {
            actionBtn = '-';
        }
        
        html += `<tr>
            <td>${c.id}</td>
            <td><code style="color:#f39c12;font-size:13px">${c.code}</code></td>
            <td>${statusBadge}</td>
            <td>${c.used_by || '-'}</td>
            <td>${c.used_at || '-'}</td>
            <td>${c.seller_id || '-'}</td>
            <td>${c.created_at ? c.created_at.substring(0, 19) : '-'}</td>
            <td>${actionBtn}</td>
        </tr>`;
    }
    tbody.innerHTML = html;
    
    const countEl = document.getElementById('acCount');
    if (countEl) countEl.textContent = `共 ${codes.length} 条`;
}

async function generateActivationCodes() {
    const count = prompt('请输入要生成的激活码数量（1-100）:', '10');
    if (!count) return;
    
    const num = parseInt(count);
    if (isNaN(num) || num < 1 || num > 100) {
        showToast('数量必须在1-100之间', 'error');
        return;
    }
    
    try {
        const res = await fetch('/api/agent/admin/generate-codes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ count: num })
        });
        const data = await res.json();
        if (data.code === 0) {
            showToast(`成功生成 ${data.data.codes.length} 个激活码`, 'success');
            // 显示生成的激活码
            let codesList = data.data.codes.join('\n');
            showModal('生成的激活码', `<pre style="color:#f39c12;white-space:pre-wrap;word-break:break-all;background:#1a1a2e;padding:15px;border-radius:8px">${codesList}</pre>`);
            loadActivationCodes();
        } else {
            showToast(data.message || '生成失败', 'error');
        }
    } catch (e) {
        showToast('生成失败: ' + e.message, 'error');
    }
}

async function cancelActivationCode(id) {
    if (!confirm('确定要作废这个激活码吗？')) return;
    
    try {
        const res = await fetch(`/api/agent/admin/codes/${id}/cancel`, {
            method: 'POST',
            credentials: 'include'
        });
        const data = await res.json();
        if (data.code === 0) {
            showToast('作废成功', 'success');
            loadActivationCodes();
        } else {
            showToast(data.message || '作废失败', 'error');
        }
    } catch (e) {
        showToast('作废失败: ' + e.message, 'error');
    }
}

// ===== 代理管理 =====
async function loadAgents() {
    try {
        const res = await fetch('/api/agent/admin/agents', {
            credentials: 'include'
        });
        const data = await res.json();
        if (data.code === 0) {
            renderAgentsTable(data.data);
        }
    } catch (e) {
        console.error('加载代理失败:', e);
    }
}

function renderAgentsTable(agents) {
    const tbody = document.getElementById('agentTableBody');
    if (!tbody) return;
    
    if (!agents || agents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#888">暂无数据</td></tr>';
        return;
    }
    
    let html = '';
    for (const a of agents) {
        let statusBadge = a.status === 'normal' 
            ? '<span class="badge badge-success">正常</span>'
            : '<span class="badge badge-danger">已冻结</span>';
        
        html += `<tr>
            <td>${a.player_id}</td>
            <td>${a.nickname || '-'}</td>
            <td><span style="color:#f39c12">Lv.${a.level}</span></td>
            <td>${a.direct_orders}</td>
            <td>${a.team_orders}</td>
            <td>${a.high_level_count}</td>
            <td>${statusBadge}</td>
            <td>${a.updated_at ? a.updated_at.substring(0, 19) : '-'}</td>
            <td><button class="btn btn-sm btn-primary" onclick="showAgentTree(${a.player_id})">下级</button></td>
        </tr>`;
    }
    tbody.innerHTML = html;
}

async function showAgentTree(playerId) {
    try {
        const res = await fetch(`/api/agent/admin/agents/${playerId}/tree`, {
            credentials: 'include'
        });
        const data = await res.json();
        if (data.code === 0) {
            let html = '<div style="padding:10px">';
            if (!data.data || data.data.length === 0) {
                html += '<p style="color:#888;text-align:center">暂无下级代理</p>';
            } else {
                html += '<table style="width:100%"><thead><tr><th>玩家ID</th><th>昵称</th><th>等级</th><th>直推单</th><th>团队单</th></tr></thead><tbody>';
                for (const sub of data.data) {
                    html += `<tr>
                        <td>${sub.player_id}</td>
                        <td>${sub.nickname || '-'}</td>
                        <td>Lv.${sub.level}</td>
                        <td>${sub.direct_orders}</td>
                        <td>${sub.team_orders}</td>
                    </tr>`;
                }
                html += '</tbody></table>';
            }
            html += '</div>';
            showModal('团队结构', html);
        }
    } catch (e) {
        showToast('加载团队失败', 'error');
    }
}

// ===== 佣金管理 =====
async function loadCommissions() {
    try {
        const res = await fetch('/api/agent/admin/commissions', {
            credentials: 'include'
        });
        const data = await res.json();
        if (data.code === 0) {
            renderCommissionsTable(data.data);
        }
    } catch (e) {
        console.error('加载佣金失败:', e);
    }
}

function renderCommissionsTable(commissions) {
    const tbody = document.getElementById('commissionTableBody');
    if (!tbody) return;
    
    if (!commissions || commissions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#888">暂无数据</td></tr>';
        return;
    }
    
    let html = '';
    for (const c of commissions) {
        let typeLabel = c.type === 'base' ? '基础佣金' : '团队奖金';
        let levelLabel = c.level === 1 ? '直推' : '间推';
        let statusBadge = '';
        if (c.status === 'pending') statusBadge = '<span class="badge badge-warning">待发放</span>';
        else if (c.status === 'settled') statusBadge = '<span class="badge badge-info">已结算</span>';
        else if (c.status === 'withdrawn') statusBadge = '<span class="badge badge-success">已提现</span>';
        
        html += `<tr>
            <td>${c.id}</td>
            <td>${c.agent_nickname || '-'}</td>
            <td>${c.order_id}</td>
            <td>${typeLabel}</td>
            <td>${levelLabel}</td>
            <td style="color:#f39c12">¥${parseFloat(c.amount).toFixed(2)}</td>
            <td>${statusBadge}</td>
            <td>${c.created_at ? c.created_at.substring(0, 19) : '-'}</td>
        </tr>`;
    }
    tbody.innerHTML = html;
}

// ===== 提现管理 =====
async function loadWithdrawals() {
    const status = document.getElementById('wdStatusFilter')?.value || '';
    try {
        let url = '/api/agent/admin/withdrawals';
        if (status) url += '?status=' + status;
        
        const res = await fetch(url, {
            credentials: 'include'
        });
        const data = await res.json();
        if (data.code === 0) {
            renderWithdrawalsTable(data.data);
        }
    } catch (e) {
        console.error('加载提现失败:', e);
    }
}

function renderWithdrawalsTable(withdrawals) {
    const tbody = document.getElementById('withdrawalTableBody');
    if (!tbody) return;
    
    if (!withdrawals || withdrawals.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#888">暂无数据</td></tr>';
        return;
    }
    
    let html = '';
    for (const w of withdrawals) {
        let statusBadge = '';
        if (w.status === 'pending') statusBadge = '<span class="badge badge-warning">申请中</span>';
        else if (w.status === 'paid') statusBadge = '<span class="badge badge-success">已打款</span>';
        else if (w.status === 'rejected') statusBadge = '<span class="badge badge-danger">已拒绝</span>';
        
        let actionBtn = '';
        if (w.status === 'pending') {
            actionBtn = `<button class="btn btn-sm btn-success" onclick="approveWithdrawal(${w.id})">确认打款</button>`;
        } else {
            actionBtn = '-';
        }
        
        html += `<tr>
            <td>${w.id}</td>
            <td>${w.agent_nickname || '-'}</td>
            <td style="color:#f39c12">¥${parseFloat(w.amount).toFixed(2)}</td>
            <td>${statusBadge}</td>
            <td>${w.apply_at ? w.apply_at.substring(0, 19) : '-'}</td>
            <td>${w.paid_at ? w.paid_at.substring(0, 19) : '-'}</td>
            <td>${w.remark || '-'}</td>
            <td>${actionBtn}</td>
        </tr>`;
    }
    tbody.innerHTML = html;
}

async function approveWithdrawal(id) {
    const remark = prompt('请输入备注（可选）:', '');
    
    try {
        const res = await fetch(`/api/agent/admin/withdrawals/${id}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ remark: remark || '' })
        });
        const data = await res.json();
        if (data.code === 0) {
            showToast('操作成功', 'success');
            loadWithdrawals();
        } else {
            showToast(data.message || '操作失败', 'error');
        }
    } catch (e) {
        showToast('操作失败: ' + e.message, 'error');
    }
}

// ===== 代理配置 =====
async function loadAgentConfig() {
    try {
        const [commRes, upgradeRes] = await Promise.all([
            fetch('/api/agent/admin/config/commission', { credentials: 'include' }),
            fetch('/api/agent/admin/config/upgrade', { credentials: 'include' })
        ]);
        
        const commData = await commRes.json();
        const upgradeData = await upgradeRes.json();
        
        if (commData.code === 0) {
            renderCommissionConfig(commData.data);
        }
        if (upgradeData.code === 0) {
            renderUpgradeConfig(upgradeData.data);
        }
    } catch (e) {
        console.error('加载配置失败:', e);
    }
}

function renderCommissionConfig(configs) {
    const tbody = document.getElementById('commissionConfigBody');
    if (!tbody) return;
    
    let html = '';
    for (const c of configs) {
        html += `<tr>
            <td>Lv.${c.level}</td>
            <td><input type="number" id="comm_direct_${c.level}" value="${c.direct_commission}" style="width:80px;padding:5px;background:#1a1a2e;border:1px solid #444;color:#fff;border-radius:4px" step="0.01"></td>
            <td><input type="number" id="comm_indirect_${c.level}" value="${c.indirect_commission}" style="width:80px;padding:5px;background:#1a1a2e;border:1px solid #444;color:#fff;border-radius:4px" step="0.01"></td>
            <td><input type="number" id="comm_bonus_${c.level}" value="${c.team_bonus}" style="width:80px;padding:5px;background:#1a1a2e;border:1px solid #444;color:#fff;border-radius:4px" step="0.01"></td>
            <td><input type="number" id="comm_gen_${c.level}" value="${c.team_bonus_generations}" style="width:80px;padding:5px;background:#1a1a2e;border:1px solid #444;color:#fff;border-radius:4px"></td>
        </tr>`;
    }
    tbody.innerHTML = html;
}

function renderUpgradeConfig(configs) {
    const tbody = document.getElementById('upgradeConfigBody');
    if (!tbody) return;
    
    let html = '';
    for (const c of configs) {
        html += `<tr>
            <td>Lv.${c.target_level}</td>
            <td><input type="number" id="upg_direct_${c.target_level}" value="${c.direct_orders_required}" style="width:80px;padding:5px;background:#1a1a2e;border:1px solid #444;color:#fff;border-radius:4px"></td>
            <td><input type="number" id="upg_team_${c.target_level}" value="${c.team_orders_required}" style="width:80px;padding:5px;background:#1a1a2e;border:1px solid #444;color:#fff;border-radius:4px"></td>
            <td><input type="number" id="upg_high_${c.target_level}" value="${c.high_level_count_required}" style="width:80px;padding:5px;background:#1a1a2e;border:1px solid #444;color:#fff;border-radius:4px"></td>
            <td>Lv.<input type="number" id="upg_type_${c.target_level}" value="${c.high_level_type}" style="width:60px;padding:5px;background:#1a1a2e;border:1px solid #444;color:#fff;border-radius:4px"></td>
        </tr>`;
    }
    tbody.innerHTML = html;
}

async function saveAgentConfig() {
    try {
        // 收集佣金配置
        const commissionConfigs = [];
        for (let level = 1; level <= 6; level++) {
            commissionConfigs.push({
                level: level,
                direct_commission: parseFloat(document.getElementById(`comm_direct_${level}`)?.value) || 0,
                indirect_commission: parseFloat(document.getElementById(`comm_indirect_${level}`)?.value) || 0,
                team_bonus: parseFloat(document.getElementById(`comm_bonus_${level}`)?.value) || 0,
                team_bonus_generations: parseInt(document.getElementById(`comm_gen_${level}`)?.value) || 0
            });
        }
        
        // 收集升级配置
        const upgradeConfigs = [];
        for (let level = 2; level <= 6; level++) {
            upgradeConfigs.push({
                target_level: level,
                direct_orders_required: parseInt(document.getElementById(`upg_direct_${level}`)?.value) || 0,
                team_orders_required: parseInt(document.getElementById(`upg_team_${level}`)?.value) || 0,
                high_level_count_required: parseInt(document.getElementById(`upg_high_${level}`)?.value) || 0,
                high_level_type: parseInt(document.getElementById(`upg_type_${level}`)?.value) || 0
            });
        }
        
        // 保存佣金配置
        const commRes = await fetch('/api/agent/admin/config/commission', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(commissionConfigs)
        });
        const commData = await commRes.json();
        
        // 保存升级配置
        const upgradeRes = await fetch('/api/agent/admin/config/upgrade', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(upgradeConfigs)
        });
        const upgradeData = await upgradeRes.json();
        
        if (commData.code === 0 && upgradeData.code === 0) {
            showToast('配置保存成功', 'success');
        } else {
            showToast('部分配置保存失败', 'warn');
        }
    } catch (e) {
        showToast('保存失败: ' + e.message, 'error');
    }
}

// ===== 页面加载时自动调用 =====
document.addEventListener('DOMContentLoaded', function() {
    // 扩展 showPage 函数来处理新页面
    const originalShowPage = window.showPage;
    if (originalShowPage) {
        window.showPage = function(pageName) {
            originalShowPage(pageName);
            
            // 加载对应数据
            if (pageName === 'activationCodes') loadActivationCodes();
            else if (pageName === 'agentManage') loadAgents();
            else if (pageName === 'commissionManage') loadCommissions();
            else if (pageName === 'withdrawalManage') loadWithdrawals();
            else if (pageName === 'agentConfig') loadAgentConfig();
        };
    }
});
