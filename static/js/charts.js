/**
 * Windows 11 Fluent Real-Time Metrics Chart Engine
 * Light-themed Chart.js renderer with smooth streaming transitions for Latency, Packet Loss, and Jitter.
 */

var healthChart = null;
var currentMetricType = 'latency'; // 'latency', 'loss', 'jitter'
var currentHistoryData = [];

function initHealthChart() {
    var canvas = document.getElementById('health-chart');
    if (!canvas) return;

    var ctx = canvas.getContext('2d');

    if (healthChart) {
        healthChart.destroy();
    }

    healthChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Latency (ms)',
                    data: [],
                    borderColor: '#0067c0',
                    backgroundColor: 'rgba(0, 103, 192, 0.08)',
                    borderWidth: 2,
                    pointBackgroundColor: '#ffffff',
                    pointBorderColor: '#0067c0',
                    pointBorderWidth: 1.8,
                    pointRadius: 3.5,
                    pointHoverRadius: 6,
                    tension: 0.3,
                    fill: true,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 250,
                easing: 'easeOutQuad',
            },
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: false,
                },
                tooltip: {
                    backgroundColor: '#ffffff',
                    titleColor: '#1c1c1c',
                    bodyColor: '#334155',
                    borderColor: '#cbd5e1',
                    borderWidth: 1,
                    padding: 8,
                    titleFont: { family: 'Segoe UI', size: 11, weight: '600' },
                    bodyFont: { family: 'JetBrains Mono', size: 11 },
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            var unit = currentMetricType === 'loss' ? '%' : ' ms';
                            return context.dataset.label + ': ' + context.parsed.y + unit;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: '#f1f5f9',
                        drawBorder: false,
                    },
                    ticks: {
                        color: '#64748b',
                        font: { family: 'Segoe UI', size: 9.5 },
                        maxTicksLimit: 8,
                    },
                },
                y: {
                    beginAtZero: true,
                    grid: {
                        color: '#f1f5f9',
                        drawBorder: false,
                    },
                    ticks: {
                        color: '#64748b',
                        font: { family: 'JetBrains Mono', size: 9.5 },
                        callback: function(val) {
                            var unit = currentMetricType === 'loss' ? '%' : ' ms';
                            return val + unit;
                        }
                    }
                }
            }
        }
    });
}

function updateHealthChart(history) {
    currentHistoryData = history || [];
    if (!healthChart) {
        initHealthChart();
    }

    if (!history || history.length === 0) {
        healthChart.data.labels = ['No Data'];
        healthChart.data.datasets[0].data = [0];
        healthChart.update('none');
        return;
    }

    var labels = [];
    var values = [];

    history.forEach(function(item) {
        var timeStr = '';
        if (item.recorded_at) {
            var d = new Date(item.recorded_at + 'Z');
            timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
        labels.push(timeStr);

        if (currentMetricType === 'latency') {
            values.push(item.latency_ms !== null ? item.latency_ms : 0);
        } else if (currentMetricType === 'loss') {
            values.push(item.packet_loss_pct !== null ? item.packet_loss_pct : 0);
        } else if (currentMetricType === 'jitter') {
            values.push(item.jitter_ms !== null ? item.jitter_ms : 0);
        }
    });

    var labelNames = {
        'latency': 'Latency',
        'loss': 'Packet Loss',
        'jitter': 'Jitter Estimate',
    };

    var metricColors = {
        'latency': { line: '#0067c0', fill: 'rgba(0, 103, 192, 0.09)' },
        'loss': { line: '#d13438', fill: 'rgba(209, 52, 56, 0.09)' },
        'jitter': { line: '#107c41', fill: 'rgba(16, 124, 65, 0.09)' },
    };

    var color = metricColors[currentMetricType] || metricColors['latency'];

    healthChart.data.labels = labels;
    healthChart.data.datasets[0].label = labelNames[currentMetricType] || 'Metric';
    healthChart.data.datasets[0].data = values;
    healthChart.data.datasets[0].borderColor = color.line;
    healthChart.data.datasets[0].backgroundColor = color.fill;
    healthChart.data.datasets[0].pointBorderColor = color.line;

    healthChart.update('none');
}

function setChartMetric(metricType, btnElem) {
    currentMetricType = metricType;

    // Toggle active button
    var container = btnElem.parentElement;
    if (container) {
        var btns = container.querySelectorAll('.metric-tab-btn');
        btns.forEach(function(b) { b.classList.remove('active'); });
        btnElem.classList.add('active');
    }

    if (currentHistoryData && currentHistoryData.length > 0) {
        updateHealthChart(currentHistoryData);
    }
}
