// --- 1. STATE (TRẠNG THÁI ỨNG DỤNG) ---
const state = {
    originalQuestions: [],
    questions: [],          
    currentIndex: 0,        
    isSubmitted: false,     
    theme: 'light',
    currentUser: null,      // Lưu thông tin User Google đang đăng nhập
    currentQuizId: null     // ID của bộ đề đang thao tác
};

// --- CẤU HÌNH FIREBASE CLOUD FIRESTORE ---
const firebaseConfig = {
  apiKey: "AIzaSyDMuyokSCS3peSzNHaU9eq9EzxgE8il66U",
  authDomain: "quiz-faff6.firebaseapp.com",
  databaseURL: "https://quiz-faff6-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "quiz-faff6",
  storageBucket: "quiz-faff6.firebasestorage.app",
  messagingSenderId: "779540232476",
  appId: "1:779540232476:web:572a4176112b0c561be2d9"
};

// Khởi tạo Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// Tên Collection và Document trên Firestore để lưu trữ đề thi
const COLLECTION_NAME = "quiz_data";
const DOC_ID = "my_current_quiz";

// --- 2. KHỞI TẠO (INIT) ---
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    setupEventListeners();
    
    // Kiểm tra: Nếu người dùng truy cập bằng Link chia sẻ thì mở bài thi đó
    const isShared = await checkSharedQuizFromUrl();
    
    // Nếu KHÔNG phải vào qua link chia sẻ thì mới tải đề đang làm dở trên Firebase
    if (!isShared) {
        await loadFromFirebase();
    }
});

function setupEventListeners() {
    // --- XỬ LÝ CLICK VÀO LOGO QUAY VỀ TRANG CHÍNH ---
    document.getElementById('app-logo')?.addEventListener('click', () => {
        // Kiểm tra: Nếu đang ở màn hình làm bài thi (quiz-section) thì hỏi xác nhận trước
        const quizSection = document.getElementById('quiz-section');
        const isDoingQuiz = quizSection && !quizSection.classList.contains('hidden-section');

        if (isDoingQuiz) {
            if (!confirm('⚠️ Bạn đang làm bài thi. Bạn có chắc muốn rời đi để về trang chính không?')) {
                return; // Hủy thao tác nếu người dùng chọn Cancel
            }
        }

        // Chuyển thẳng về màn hình chính (Setup Section)
        switchSection('setup-section');
    });
    // --- AUTH & THEME ---
    setupAuthListeners();
    document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

    // --- SECTION 1: NHẬP DỮ LIỆU ---
    document.getElementById('btn-parse')?.addEventListener('click', handleDataInput);
    document.getElementById('btn-clear-data')?.addEventListener('click', clearData);
    // --- XỬ LÝ NÚT XÓA FILE WORD (.DOCX) ---
    const fileInput = document.getElementById('word-file');
    const btnRemoveFile = document.getElementById('btn-remove-file');

    // Hàm kiểm tra và bật/tắt nút Xóa file
    const toggleRemoveButton = () => {
        if (fileInput && fileInput.files && fileInput.files.length > 0) {
            btnRemoveFile?.classList.remove('hidden');
        } else {
            btnRemoveFile?.classList.add('hidden');
        }
    };

    // 1. KÍCH HOẠT NGAY KHI LOAD TRANG (Khắc phục lỗi F5 bị mất nút X)
    toggleRemoveButton();

    // 2. Khi người dùng chọn file mới -> Kiểm tra lại
    fileInput?.addEventListener('change', toggleRemoveButton);

    // 3. Khi bấm nút "❌ Xóa file" -> Rút file ra & ẩn nút
    btnRemoveFile?.addEventListener('click', () => {
        if (fileInput) {
            fileInput.value = ''; // Xóa sạch file trong ô input
        }
        toggleRemoveButton(); // Ẩn nút X đi
    });

    // --- SECTION 2: PREVIEW & LƯU TRỮ ---
    document.getElementById('btn-shuffle-questions')?.addEventListener('click', shuffleQuestions);
    document.getElementById('btn-shuffle-options')?.addEventListener('click', shuffleOptions);
    document.getElementById('btn-start-quiz')?.addEventListener('click', startQuiz);
    document.getElementById('btn-back-setup')?.addEventListener('click', () => switchSection('setup-section'));
    document.getElementById('btn-save-account')?.addEventListener('click', saveCurrentQuizToAccount);

    // --- SECTION 3: QUIZ (CÁC NÚT ĐANG BỊ LIỆT CỦA BẠN Ở ĐÂY) ---
    document.getElementById('btn-exit-quiz')?.addEventListener('click', exitQuiz);
    document.getElementById('btn-prev')?.addEventListener('click', prevQuestion);
    document.getElementById('btn-next')?.addEventListener('click', nextQuestion);
    document.getElementById('btn-submit')?.addEventListener('click', submitQuiz);

    // --- SECTION 4: KẾT QUẢ ---
    document.getElementById('btn-review')?.addEventListener('click', toggleReview);
    document.getElementById('btn-restart')?.addEventListener('click', resetQuiz);

    // --- XỬ LÝ CHỌN CHẾ ĐỘ CHIA NHỎ ĐỀ THI ---
    const chunkSelect = document.getElementById('chunk-size-select');
    const chunkInfo = document.getElementById('chunk-info-text');

    chunkSelect?.addEventListener('change', () => {
        const total = state.originalQuestions.length || state.questions.length;
        const val = chunkSelect.value;

        if (val === 'all' || parseInt(val) >= total) {
            chunkInfo.innerText = `Sẽ làm toàn bộ ${total} câu.`;
        } else {
            chunkInfo.innerText = `⚡ Sẽ ngẫu nhiên lấy ra ${val} câu từ tổng số ${total} câu để ôn tập.`;
        }
    });
}
// --- 3. ĐỌC DỮ LIỆU & PARSE (CORE LOGIC) ---
async function handleDataInput() {
    const fileInput = document.getElementById('word-file');
    const textArea = document.getElementById('raw-text');
    
    if (fileInput && fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const reader = new FileReader();
        
        reader.onload = async function(event) {
            const arrayBuffer = event.target.result;
            try {
                const result = await mammoth.convertToHtml({arrayBuffer: arrayBuffer});
                let htmlStr = result.value;
                let textStr = htmlStr.replace(/<\/p>/gi, '\n')
                                     .replace(/<br\s*\/?>/gi, '\n') 
                                     .replace(/<[^>]+>/g, '');
                parseTextToQuestions(textStr);
            } catch (err) {
                alert("Lỗi đọc file Word: " + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
    } else if (textArea && textArea.value.trim() !== '') {
        parseTextToQuestions(textArea.value);
    } else {
        alert("Vui lòng tải lên file Word hoặc nhập nội dung đề thi!");
    }
}

function parseTextToQuestions(rawText) {
    let processedText = rawText;

    // 1. Nếu dấu * bị gõ cách chữ A, B, C, D bởi khoảng trắng (VD: "* B." -> "*B.")
    processedText = processedText.replace(/\*\s+([A-D][.:)\-])/gi, '*$1');

    // 2. Nếu dấu * bị dính vào đuôi từ phía trước (VD: "chung.*B." -> "chung. *B.")
    processedText = processedText.replace(/(\S)\*+([A-D][.:)\-])/gi, '$1 *$2');

    // 3. QUAN TRỌNG NHẤT: Nếu dấu * bị rớt ở cuối câu A ngay trước khi xuống dòng B
    // (VD: "...tri thức chung.*\nB." -> "...tri thức chung.\n*B.") -> Hút ngược về B!
    processedText = processedText.replace(/\*\s*\r?\n\s*([A-D][.:)\-])/gi, '\n*$1');
    // 0. TIỀN XỬ LÝ DỮ LIỆU THÔNG MINH (Smart Pre-processing)
    
    // a. Tách câu hỏi dính chùm vào cuối đáp án
    processedText = processedText.replace(/([^\s\n])\s+(\*?\s*(?:Câu|Question)\s*\d+[:.\-]?)/gi, '$1\n$2');

    // b. Xử lý đáp án A, B, C, D bị dính chùm vào văn bản
    
    // Bước b1: Dính liền hoàn toàn KHÔNG có khoảng trắng (VD: cạn".A. Sống)
    processedText = processedText.replace(/([.?!:;"'”’»\]}])(\*?[A-D][.:)\-]\s+)/g, '$1\n$2');

    // Bước b2: Dính chữ CÓ khoảng trắng (VD: cạn". A. Sống)
    // Thay vì dùng regex cứng nhắc, ta dùng hàm Javascript để phân tích ngữ nghĩa của từ đứng trước.
    processedText = processedText.replace(/(\S+)\s+(\*?[A-D][.:)\-]\s+)/g, function(match, word, option) {
        
        // Làm sạch từ đứng trước (vứt bỏ mọi dấu câu, chỉ giữ lại chữ cái tiếng Việt)
        const cleanWord = word.toLowerCase().replace(/[^a-záàạảãăắằặẳẵâấầậẩẫéèẹẻẽêếềệểễíìịỉĩóòọỏõôốồộổỗơớờợởỡúùụủũưứừựửữýỳỵỷỹđ]/g, '');
        
        // Danh sách "Kim Bài Miễn Tử": Những từ được phép đi liền với A, B, C, D
        const skipWords = [
            "hình", "bảng", "mục", "phần", "câu", "án", "là", "chữ", 
            "điểm", "đáp", "loại", "từ", "như", "bằng", "với", "thành", 
            "gọi", "ông", "bà", "anh", "chị", "em", "bạn", "của", "và"
        ];
        
        // Nếu từ đứng trước nằm trong danh sách cấm cắt -> Giữ nguyên (VD: Hình A.)
        if (skipWords.includes(cleanWord)) {
            return match; 
        }
        
        // Nếu là từ bình thường (VD: cạn) -> Ép đáp án xuống dòng
        return word + '\n' + option; 
    });

    const lines = processedText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const parsedQuestions = [];
    let currentQuestion = null;

    const questionRegex = /^(?:\*?\s*)(?:Câu|Question)\s*\d+[:.\-]?\s*(.*)/i;
    const optionRegex = /^(?:\*?\s*)([A-D])[.:)\-]\s*(.*)/i;
    const answerKeyRegex = /^\*\s*(?:Câu|Question)\s*(\d+)[\s:.\-]*([A-D])\s*$/i;

    lines.forEach(line => {
        const keyMatch = line.match(answerKeyRegex);
        if (keyMatch && keyMatch[2]) {
            const qIndex = parseInt(keyMatch[1]) - 1;
            const correctLabel = keyMatch[2].toUpperCase();
            if (parsedQuestions[qIndex]) {
                parsedQuestions[qIndex].options.forEach(opt => {
                    if (opt.label === correctLabel) opt.isCorrect = true;
                });
            }
            return; 
        }

        const qMatch = line.match(questionRegex);
        if (qMatch) {
            if (currentQuestion) parsedQuestions.push(currentQuestion);
            currentQuestion = {
                id: generateId(),
                text: line.replace(/^\*?\s*/, ''), 
                options: [],
                userChoice: null
            };
            return;
        }

       const oMatch = line.match(optionRegex);
        if (oMatch && currentQuestion) {
            // 1. Cắt sạch dấu cách/ký tự ẩn ở 2 đầu ngay lập tức
            let optText = oMatch[2].trim();
            let isCorrect = false;

            // 2. Nhận diện dấu * ở đầu dòng (*A. Nội dung) hoặc đầu đáp án (A. *Nội dung)
            if (line.trim().startsWith('*') || optText.startsWith('*')) {
                isCorrect = true;
                optText = optText.replace(/^\*\s*/, '').trim();
            }

            // 3. Nhận diện dấu * dính ở cuối đáp án (VD: "...tri thức chung.*" hoặc "...chung. *  ")
            // Dùng Regex /\*\s*$/ để tóm gọn dấu * ở cuối câu dù phía sau có bao nhiêu dấu cách ẩn!
            if (/\*\s*$/.test(optText)) {
                isCorrect = true;
                optText = optText.replace(/\*\s*$/, '').trim();
            }
            
            // 4. Nhận diện thêm các kiểu phổ biến như (đáp án đúng) hoặc (*)
            if (/\(đáp án đúng\)|\(\*\)/i.test(optText)) {
                isCorrect = true;
                optText = optText.replace(/\(đáp án đúng\)|\(\*\)/gi, '').trim();
            }

            currentQuestion.options.push({
                id: generateId(),
                label: oMatch[1].toUpperCase(),
                text: optText,
                isCorrect: isCorrect
            });
            return;
        }

        if (currentQuestion) {
            if (currentQuestion.options.length === 0) {
                currentQuestion.text += '\n' + line;
            } else {
                const lastOpt = currentQuestion.options[currentQuestion.options.length - 1];
                lastOpt.text += '\n' + line;
            }
        }
    });

    if (currentQuestion) parsedQuestions.push(currentQuestion);

    // --- BỘ LỌC RÁC TỰ ĐỘNG ---
    const validQuestions = parsedQuestions.filter(q => q.options.length > 0);

    if (validQuestions.length === 0) {
        alert("Không tìm thấy câu hỏi nào! Hãy kiểm tra lại định dạng tài liệu.");
        return;
    }

    state.questions = validQuestions;
    state.currentIndex = 0;
    state.isSubmitted = false;
    
    saveState();
    renderPreview();
    switchSection('preview-section');
}

// --- 4. PREVIEW & CÁC CHỨC NĂNG TRỘN ---
function renderPreview() {
    const tbody = document.getElementById('preview-tbody');
    document.getElementById('total-preview-count').innerText = state.questions.length;
    tbody.innerHTML = '';

    state.questions.forEach((q, index) => {
        const tr = document.createElement('tr');
        
        // Cột câu hỏi
        const tdQ = document.createElement('td');
        tdQ.innerText = `Câu ${index + 1}: ${q.text}`;
        tr.appendChild(tdQ);

        // Cột đáp án
        const tdOpts = document.createElement('td');
        q.options.forEach(opt => {
            const span = document.createElement('span');
            span.className = 'preview-opt' + (opt.isCorrect ? ' correct' : '');
            span.innerText = `${opt.label}. ${opt.text}`;
            tdOpts.appendChild(span);
        });
        tr.appendChild(tdOpts);

        // Cột Thao tác (MỚI)
        const tdAction = document.createElement('td');
        tdAction.style.textAlign = 'center';
        const btnEdit = document.createElement('button');
        btnEdit.className = 'btn btn-outline';
        btnEdit.style.padding = '0.4rem 0.8rem';
        btnEdit.innerHTML = '✏️ Sửa';
        // Truyền ID câu hỏi vào hàm để biết đang sửa câu nào
        btnEdit.onclick = () => openEditModal(q.id);
        tdAction.appendChild(btnEdit);
        tr.appendChild(tdAction);

        tbody.appendChild(tr);
    });
}

function shuffleQuestions() {
    for (let i = state.questions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.questions[i], state.questions[j]] = [state.questions[j], state.questions[i]];
    }
    saveState();
    renderPreview();
}

function shuffleOptions() {
    state.questions.forEach(q => {
        for (let i = q.options.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [q.options[i], q.options[j]] = [q.options[j], q.options[i]];
        }
        const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
        q.options.forEach((opt, idx) => {
            opt.label = labels[idx] || '';
        });
    });
    saveState();
    renderPreview();
}

// --- 5. LOGIC LÀM BÀI QUIZ ---
function startQuiz() {
    // 0. Đảm bảo luôn lấy nguồn từ bộ đề gốc nếu có
    if (state.originalQuestions && state.originalQuestions.length > 0) {
        state.questions = [...state.originalQuestions];
    } else {
        state.originalQuestions = [...state.questions];
    }

    // 1. KIỂM TRA CHẾ ĐỘ CHIA NHỎ ĐỀ THI
    const chunkSelect = document.getElementById('chunk-size-select');
    if (chunkSelect && chunkSelect.value !== 'all') {
        const limit = parseInt(chunkSelect.value);
        if (limit < state.questions.length) {
            // Trộn đều mảng gốc và chỉ cắt lấy đúng số lượng câu người dùng chọn
            const shuffled = [...state.originalQuestions].sort(() => Math.random() - 0.5);
            state.questions = shuffled.slice(0, limit);
            console.log(`🎯 Đã cắt đề: Lấy ngẫu nhiên ${limit} câu / ${state.originalQuestions.length} câu gốc.`);
        }
    }

    // 2. Các bước khởi tạo làm bài cũ của bạn giữ nguyên bên dưới
    state.currentIndex = 0;
    state.isSubmitted = false;

    renderCurrentQuestion();  // Sửa từ renderQuestion thành renderCurrentQuestion
    buildQuestionNav();
    switchSection('quiz-section');
    // 1. TÍNH NĂNG MỚI: Kiểm tra xem có câu nào chưa có đáp án đúng hoặc chưa có đáp án nào không
    const invalidIndex = state.questions.findIndex(q => {
        // Lỗi 1: Câu hỏi không có đáp án nào (A, B, C, D trống)
        if (!q.options || q.options.length === 0) return true;
        // Lỗi 2: Chưa có đáp án nào được đánh dấu là đúng (isCorrect === true)
        const hasCorrectOption = q.options.some(opt => opt.isCorrect);
        return !hasCorrectOption;
    });

    // 2. Nếu phát hiện câu lỗi -> Chặn thi + Báo lỗi + Mở ngay Modal sửa câu đó
    if (invalidIndex !== -1) {
        const errorQuestion = state.questions[invalidIndex];
        alert(`⚠️ Câu số ${invalidIndex + 1} hiện chưa có đáp án đúng!\n\nHệ thống sẽ mở khung chỉnh sửa để bạn chọn/sửa lại đáp án cho câu này trước khi bắt đầu làm bài.`);
        
        // Tự động mở Modal chỉnh sửa đúng câu bị lỗi
        openEditModal(errorQuestion.id);
        return; // Dừng lại, không cho phép chuyển sang màn hình làm bài thi
    }

    // 3. Nếu tất cả câu hỏi đều hợp lệ -> Vào thi bình thường
    switchSection('quiz-section');
    buildQuestionNav();
    renderCurrentQuestion();
}

function renderCurrentQuestion() {
    const q = state.questions[state.currentIndex];
    
    document.getElementById('current-question-title').innerText = `Câu ${state.currentIndex + 1}/${state.questions.length}`;
    const progressPercent = ((state.currentIndex + 1) / state.questions.length) * 100;
    document.getElementById('progress-fill').style.width = `${progressPercent}%`;

    const qTextEl = document.getElementById('question-text');
    qTextEl.innerText = q.text;

    const optionsContainer = document.getElementById('options-container');
    optionsContainer.innerHTML = '';

    q.options.forEach(opt => {
        const label = document.createElement('label');
        label.className = 'option-label';
        
        if (q.userChoice === opt.id) {
            label.classList.add('selected');
        }

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = `question_${q.id}`;
        input.value = opt.id;
        input.checked = (q.userChoice === opt.id);
        
        input.addEventListener('change', () => {
            optionsContainer.querySelectorAll('.option-label').forEach(l => l.classList.remove('selected'));
            label.classList.add('selected');
            
            state.questions[state.currentIndex].userChoice = opt.id;
            updateNavStatus();
            saveState();
        });

        label.appendChild(input);
        label.appendChild(document.createTextNode(` ${opt.label}. ${opt.text}`));
        optionsContainer.appendChild(label);
    });

    updateNavButtons();
    updateNavStatus();
}

function prevQuestion() {
    if (state.currentIndex > 0) {
        state.currentIndex--;
        renderCurrentQuestion();
        saveState();
    }
}

function nextQuestion() {
    if (state.currentIndex < state.questions.length - 1) {
        state.currentIndex++;
        renderCurrentQuestion();
        saveState();
    }
}

function jumpToQuestion(index) {
    state.currentIndex = index;
    renderCurrentQuestion();
    saveState();
}

function updateNavButtons() {
    // Đã xóa nút Câu Trước / Câu Sau
    // Luôn hiển thị nút Nộp Bài để người dùng có thể nộp bất kỳ lúc nào
    const btnSubmit = document.getElementById('btn-submit');
    if (btnSubmit) {
        btnSubmit.classList.remove('hidden');
    }
}

function buildQuestionNav() {
    const navGrid = document.getElementById('question-nav-grid');
    if(!navGrid) return;
    navGrid.innerHTML = '';
    
    state.questions.forEach((q, index) => {
        const btn = document.createElement('button');
        btn.className = 'nav-btn';
        btn.innerText = index + 1;
        btn.id = `nav-btn-${index}`;
        btn.addEventListener('click', () => jumpToQuestion(index));
        navGrid.appendChild(btn);
    });
}

function updateNavStatus() {
    state.questions.forEach((q, index) => {
        const btn = document.getElementById(`nav-btn-${index}`);
        if (!btn) return;

        if (q.userChoice) btn.classList.add('answered');
        else btn.classList.remove('answered');

        if (index === state.currentIndex) btn.classList.add('active');
        else btn.classList.remove('active');
    });
}

// --- 6. NỘP BÀI & KẾT QUẢ ---
function submitQuiz() {
    state.isSubmitted = true;
    
    // Gọi hàm tính toán điểm số
    if (typeof calculateResult === 'function') {
        calculateResult();
    }
    
    // Chuyển sang màn hình kết quả
    switchSection('result-section');
    saveState();
}
function calculateResult() {
    let correctCount = 0;
    
    state.questions.forEach(q => {
        const selectedOpt = q.options.find(o => o.id === q.userChoice);
        if (selectedOpt && selectedOpt.isCorrect) {
            correctCount++;
        }
    });

    const total = state.questions.length;
    const wrongCount = total - correctCount;
    const score = (correctCount / total) * 10; 
    const percentage = Math.round((correctCount / total) * 100);

    document.getElementById('score-text').innerText = score.toFixed(1);
    document.getElementById('correct-count').innerText = correctCount;
    document.getElementById('wrong-count').innerText = wrongCount;
    document.getElementById('percentage-text').innerText = `${percentage}%`;

    buildReviewList();
}

function buildReviewList() {
    const reviewContainer = document.getElementById('review-container');
    if(!reviewContainer) return;
    reviewContainer.innerHTML = '';

    state.questions.forEach((q, index) => {
        const div = document.createElement('div');
        div.className = 'review-item';
        
        const qTitle = document.createElement('h4');
        qTitle.innerText = `Câu ${index + 1}: ${q.text}`;
        div.appendChild(qTitle);

        const optsDiv = document.createElement('div');
        optsDiv.className = 'options-grid';
        optsDiv.style.marginTop = '1rem';

        q.options.forEach(opt => {
            const label = document.createElement('div');
            label.className = 'option-label';
            label.style.cursor = 'default';
            
            if (opt.isCorrect) {
                label.classList.add('is-correct'); 
            } 
            if (q.userChoice === opt.id && !opt.isCorrect) {
                label.classList.add('is-wrong'); 
            }
            
            const icon = document.createElement('span');
            icon.style.marginRight = '10px';
            if (q.userChoice === opt.id) {
                icon.innerHTML = '👉'; 
            } else {
                icon.innerHTML = '⬛';
                icon.style.opacity = '0.2';
            }

            label.appendChild(icon);
            label.appendChild(document.createTextNode(` ${opt.label}. ${opt.text}`));
            optsDiv.appendChild(label);
        });

        div.appendChild(optsDiv);
        reviewContainer.appendChild(div);
    });
}

function toggleReview() {
    const container = document.getElementById('review-container');
    if(container) {
        container.classList.toggle('hidden');
    }
}

function resetQuiz() {
    state.questions.forEach(q => q.userChoice = null);
    state.currentIndex = 0;
    state.isSubmitted = false;
    saveState();
    startQuiz();
}

async function clearData() {
    if (confirm('Bạn có chắc muốn xóa vĩnh viễn đề thi đang lưu trên Firebase?')) {
        try {
            await db.collection(COLLECTION_NAME).doc(DOC_ID).delete();
            alert("🗑️ Đã xóa dữ liệu trên đám mây!");
            location.reload();
        } catch (error) {
            console.error("❌ Lỗi xóa dữ liệu:", error);
            alert("Không thể xóa dữ liệu: " + error.message);
        }
    }
}

// --- 7. UTILS & BẢO LƯU TRẠNG THÁI ---
function switchSection(sectionId) {
    // 1. Chỉ ẩn 4 màn hình chính của bài thi, KHÔNG ẩn kho đề thi (#my-quizzes-section)
    const mainSections = ['setup-section', 'preview-section', 'quiz-section', 'result-section'];
    
    mainSections.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('hidden-section'); // Hoặc 'hidden' tùy class CSS bạn dùng
        }
    });

    // 2. Hiện màn hình được chọn
    const activeSection = document.getElementById(sectionId);
    if (activeSection) {
        activeSection.classList.remove('hidden-section');
        activeSection.classList.remove('hidden');
    }

    // 3. Nếu quay về màn hình chính (setup-section) và ĐÃ đăng nhập -> Luôn hiện Kho đề thi
    const myQuizzes = document.getElementById('my-quizzes-section');
    if (sectionId === 'setup-section' && state.currentUser) {
        myQuizzes?.classList.remove('hidden');
    } else if (sectionId !== 'setup-section') {
        // Khi vào phòng làm bài thi thì ẩn kho đề thi đi cho gọn màn hình
        myQuizzes?.classList.add('hidden');
    }
}

function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

async function saveState() {
    try {
        // Firestore yêu cầu Object thuần, không nhận class hay function
        const dataToSave = {
            questions: state.questions,
            currentIndex: state.currentIndex,
            isSubmitted: state.isSubmitted,
            theme: state.theme,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        await db.collection(COLLECTION_NAME).doc(DOC_ID).set(dataToSave, { merge: true });
        console.log("✅ Đã đồng bộ dữ liệu lên Firebase Firestore!");
    } catch (error) {
        console.error("❌ Lỗi lưu dữ liệu lên Firebase:", error);
    }
}

async function loadFromFirebase() {
    try {
        const docRef = db.collection(COLLECTION_NAME).doc(DOC_ID);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            const savedData = docSnap.data();

            if (savedData.questions && savedData.questions.length > 0) {
                // Phục hồi trạng thái vào state toàn cục
                state.questions = savedData.questions;
                state.currentIndex = savedData.currentIndex || 0;
                state.isSubmitted = savedData.isSubmitted || false;
                state.theme = savedData.theme || 'light';

                // Hiển thị nút "Tiếp tục đề đã lưu" và "Xóa dữ liệu cũ" trên giao diện
                document.getElementById('btn-continue-saved')?.classList.remove('hidden');
                document.getElementById('btn-clear-data')?.classList.remove('hidden');

                if (state.isSubmitted) {
                    calculateResult();
                    switchSection('result-section');
                } else if (state.questions.length > 0) {
                    // Nếu muốn vào thẳng màn hình review đề vừa tải:
                    renderPreview();
                }
            }
        } else {
            console.log("ℹ️ Chưa có dữ liệu bài thi nào trên Firestore.");
        }
    } catch (error) {
        console.error("❌ Lỗi đọc dữ liệu từ Firebase:", error);
    }
}
// --- 8. GIAO DIỆN DARK MODE ---
function initTheme() {
    const savedTheme = localStorage.getItem('quizProTheme');
    if (savedTheme === 'dark') {
        state.theme = 'dark';
        document.body.classList.add('dark-mode');
        const themeBtn = document.getElementById('theme-toggle');
        if(themeBtn) themeBtn.innerText = '☀️ Light Mode';
    }
}

function toggleTheme() {
    const themeBtn = document.getElementById('theme-toggle');
    if (document.body.classList.contains('dark-mode')) {
        document.body.classList.remove('dark-mode');
        state.theme = 'light';
        if(themeBtn) themeBtn.innerText = '🌙 Dark Mode';
        localStorage.setItem('quizProTheme', 'light');
    } else {
        document.body.classList.add('dark-mode');
        state.theme = 'dark';
        if(themeBtn) themeBtn.innerText = '☀️ Light Mode';
        localStorage.setItem('quizProTheme', 'dark');
    }
}
// --- 9. TÍNH NĂNG CHỈNH SỬA (EDIT MODAL) ---
let editingQuestionId = null;

function openEditModal(qId) {
    editingQuestionId = qId;
    const q = state.questions.find(x => x.id === qId);
    if (!q) return;

    // 1. Load nội dung câu hỏi
    document.getElementById('edit-q-text').value = q.text;
    
    // 2. Load danh sách đáp án hiện có
    const optsContainer = document.getElementById('edit-options-container');
    optsContainer.innerHTML = '<label>Các đáp án (Tích Radio để chọn đáp án đúng):</label>';

    q.options.forEach((opt) => {
        createOptionRow(optsContainer, opt.id, opt.label, opt.text, opt.isCorrect);
    });

    // 3. Hiện Modal
    document.getElementById('edit-modal').classList.remove('hidden');
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.add('hidden');
    editingQuestionId = null;
}

// Hàm đẻ thêm 1 đáp án mới (Khi user bấm nút Thêm Đáp Án)
function addOptionToModal() {
    const optsContainer = document.getElementById('edit-options-container');
    // Tính xem đang có bao nhiêu đáp án để tự động gợi ý tên (A, B, C...)
    const currentCount = optsContainer.querySelectorAll('.edit-opt-row').length;
    const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const nextLabel = labels[currentCount] || 'X';
    
    createOptionRow(optsContainer, generateId(), nextLabel, '', false);
}

// Hàm dùng chung để tạo ra 1 hàng (row) đáp án trong Modal
function createOptionRow(container, id, label, text, isCorrect) {
    const row = document.createElement('div');
    row.className = 'edit-opt-row';
    row.dataset.id = id; 
    
    // Nút Radio
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'edit-correct-opt';
    radio.value = id;
    radio.checked = isCorrect;

    // Ô nhập nhãn (A, B, C, D) -> Cho phép user tự sửa thành A nếu muốn!
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'edit-opt-letter';
    labelInput.style.width = '45px';
    labelInput.style.fontWeight = 'bold';
    labelInput.style.textAlign = 'center';
    labelInput.value = label;

    // Ô nhập text đáp án
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'edit-opt-input';
    textInput.value = text;
    textInput.placeholder = "Nhập nội dung...";

    // Nút thùng rác (để xóa đáp án thừa)
    const btnDelete = document.createElement('button');
    btnDelete.innerHTML = '🗑️';
    btnDelete.className = 'btn-icon text-danger';
    btnDelete.title = "Xóa đáp án này";
    btnDelete.onclick = () => row.remove(); // Bấm là bay màu hàng này

    // Đẩy tất cả vào row
    row.appendChild(radio);
    row.appendChild(labelInput);
    row.appendChild(textInput);
    row.appendChild(btnDelete);
    
    container.appendChild(row);
}

// Lưu mọi thay đổi
// Lưu mọi thay đổi
async function saveEdit() {
    if (!editingQuestionId) return;
    const q = state.questions.find(x => x.id === editingQuestionId);
    if (!q) return;

    // 1. Cập nhật câu hỏi
    q.text = document.getElementById('edit-q-text').value.trim();

    // 2. Lấy Radio nào đang được tích
    const correctRadio = document.querySelector('input[name="edit-correct-opt"]:checked');
    const correctOptId = correctRadio ? correctRadio.value : null;

    // 3. Quét toàn bộ các hàng đáp án hiện có trong Modal để cập nhật
    const rows = document.querySelectorAll('#edit-options-container .edit-opt-row');
    const newOptions = [];

    rows.forEach(row => {
        const id = row.dataset.id;
        const letter = row.querySelector('.edit-opt-letter').value.trim().toUpperCase() || 'X';
        const textValue = row.querySelector('.edit-opt-input').value.trim();
        const isCorrect = (id === correctOptId);
        
        newOptions.push({
            id: id,
            label: letter,
            text: textValue,
            isCorrect: isCorrect
        });
    });

    // 4. Tự động sắp xếp các đáp án theo bảng chữ cái A, B, C, D...
    newOptions.sort((a, b) => a.label.localeCompare(b.label));

    // 5. Ghi đè vào dữ liệu gốc
    q.options = newOptions;

    // 6. QUAN TRỌNG: Nếu đang mở đề thi từ Kho tài khoản -> Cập nhật vĩnh viễn lên Firestore tài khoản!
    if (state.currentUser && state.currentQuizId) {
        try {
            await db.collection('users')
                    .doc(state.currentUser.uid)
                    .collection('quizzes')
                    .doc(state.currentQuizId)
                    .update({
                        questions: state.questions
                    });
            console.log("✅ Đã cập nhật vĩnh viễn câu hỏi vào kho đề thi tài khoản!");
        } catch (error) {
            console.error("❌ Lỗi cập nhật kho đề thi:", error);
        }
    }

    // 7. Cập nhật state tạm & giao diện
    saveState();
    renderPreview();
    closeEditModal();
}

// --- XỬ LÝ ĐĂNG NHẬP / ĐĂNG XUẤT GOOGLE ---
function setupAuthListeners() {
    // Nút Đăng nhập Google
    document.getElementById('btn-login-google')?.addEventListener('click', async () => {
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            await auth.signInWithPopup(provider);
        } catch (error) {
            alert("Lỗi đăng nhập: " + error.message);
        }
    });

    // Nút Đăng xuất
    document.getElementById('btn-logout')?.addEventListener('click', () => {
        auth.signOut();
    });

    // Lắng nghe trạng thái đăng nhập tự động
    auth.onAuthStateChanged(user => {
        const btnLogin = document.getElementById('btn-login-google');
        const userInfo = document.getElementById('user-info');
        const myQuizzesSection = document.getElementById('my-quizzes-section');
        const btnSaveAccount = document.getElementById('btn-save-account');

        if (user) {
            // Khi đã đăng nhập
            state.currentUser = user;
            btnLogin?.classList.add('hidden');
            userInfo?.classList.remove('hidden');
            btnSaveAccount?.classList.remove('hidden');
            myQuizzesSection?.classList.remove('hidden');

            document.getElementById('user-name').innerText = user.displayName;
            document.getElementById('user-avatar').src = user.photoURL;

            // Tải danh sách đề thi của riêng user này
            loadUserQuizzes();
        } else {
            // Khi đăng xuất
            state.currentUser = null;
            btnLogin?.classList.remove('hidden');
            userInfo?.classList.add('hidden');
            btnSaveAccount?.classList.add('hidden');
            myQuizzesSection?.classList.add('hidden');
        }
    });
}

// --- QUẢN LÝ KHO ĐỀ THI THEO TÀI KHOẢN ---

/**
 * Lưu bộ đề hiện tại vào tài khoản Google
 */
async function saveCurrentQuizToAccount() {
    if (!state.currentUser) {
        alert("Vui lòng đăng nhập Google để lưu đề thi!");
        return;
    }
    if (state.questions.length === 0) {
        alert("Không có câu hỏi nào để lưu!");
        return;
    }

    const title = prompt("Nhập tên bộ đề thi của bạn:", "Đề thi trắc nghiệm mới");
    if (!title) return;

    try {
        const userQuizzesRef = db.collection('users').doc(state.currentUser.uid).collection('quizzes');
        
        await userQuizzesRef.add({
            title: title,
            questions: state.questions,
            totalQuestions: state.questions.length,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        alert("✅ Đã lưu bộ đề vào kho tài khoản của bạn!");
        loadUserQuizzes(); // Tải lại danh sách
    } catch (error) {
        console.error("Lỗi lưu bộ đề:", error);
        alert("Không thể lưu đề thi: " + error.message);
    }
}

/**
 * Tải danh sách các đề thi đã lưu của User
 */
async function loadUserQuizzes() {
    if (!state.currentUser) return;

    const listEl = document.getElementById('quizzes-list');
    const countEl = document.getElementById('saved-quizzes-count');
    if (!listEl) return;

    listEl.innerHTML = '<p>Đang tải danh sách đề thi...</p>';

    try {
        const querySnapshot = await db.collection('users')
                                      .doc(state.currentUser.uid)
                                      .collection('quizzes')
                                      .orderBy('createdAt', 'desc')
                                      .get();

        countEl.innerText = querySnapshot.size;
        listEl.innerHTML = '';

        if (querySnapshot.empty) {
            listEl.innerHTML = '<p class="text-muted">Bạn chưa lưu đề thi nào. Hãy tải file Word lên và bấm "Lưu vào tài khoản".</p>';
            return;
        }

        querySnapshot.forEach(doc => {
            const quizData = doc.data();
            const card = document.createElement('div');
            card.className = 'quiz-card-item';

            // --- 1. CHỈ TẠO 1 LẦN DUY NHẤT CẤU TRÚC THẺ ---
            card.innerHTML = `
                <div>
                    <h3>${quizData.title || 'Đề thi không tên'}</h3>
                    <div class="quiz-card-meta">
                        <span>Số câu: <strong>${quizData.totalQuestions}</strong> câu</span>
                    </div>
                </div>
                <div class="quiz-card-actions">
                    <button class="btn btn-primary btn-sm btn-open-quiz" data-id="${doc.id}">📖 Làm bài</button>
                    <button class="btn btn-secondary btn-sm btn-share-quiz" data-id="${doc.id}">🔗 Chia sẻ</button>
                    <button class="btn btn-danger btn-sm btn-delete-quiz" data-id="${doc.id}">🗑️</button>
                </div>
            `;

            // --- 2. GẮN SỰ KIỆN CHO 3 NÚT ---
            // Nút Làm bài
            card.querySelector('.btn-open-quiz').addEventListener('click', () => loadQuizById(doc.id, quizData));
            
            // Nút Chia sẻ
            card.querySelector('.btn-share-quiz').addEventListener('click', () => {
                const shareUrl = `${window.location.origin}${window.location.pathname}?uid=${state.currentUser.uid}&id=${doc.id}`;
                navigator.clipboard.writeText(shareUrl).then(() => {
                    alert("🔗 Đã sao chép link đề thi vào bộ nhớ tạm!\n\n" + shareUrl);
                }).catch(() => {
                    prompt("Hãy copy đường link đề thi dưới đây để gửi cho bạn bè:", shareUrl);
                });
            });

            // Nút Xóa đề thi
            card.querySelector('.btn-delete-quiz').addEventListener('click', () => deleteQuizById(doc.id, quizData.title));

            listEl.appendChild(card);
        });
    } catch (error) {
        console.error("Lỗi tải danh sách:", error);
        listEl.innerHTML = '<p class="text-danger">Lỗi khi tải kho đề thi!</p>';
    }
}

/**
 * Mở đề thi từ kho để ôn luyện
 */
function loadQuizById(quizId, quizData) {
    state.questions = quizData.questions;
    state.currentQuizId = quizId;
    state.currentIndex = 0;
    state.isSubmitted = false;

    renderPreview();
    switchSection('preview-section');
}

/**
 * Xóa một đề thi trong kho
 */
async function deleteQuizById(quizId, title) {
    if (!confirm(`Bạn có chắc muốn xóa đề thi "${title}"?`)) return;

    try {
        await db.collection('users')
                .doc(state.currentUser.uid)
                .collection('quizzes')
                .doc(quizId)
                .delete();

        alert("🗑️ Đã xóa đề thi!");
        loadUserQuizzes();
    } catch (error) {
        alert("Lỗi xóa đề thi: " + error.message);
    }
}

function exitQuiz() {
    if (state.questions && state.questions.length > 0) {
        switchSection('preview-section'); // Quay ngay về danh sách câu hỏi
    } else {
        switchSection('setup-section');   // Quay về trang chính
    }
}

// --- XỬ LÝ LINK CHIA SẺ (URL PARAMETERS) ---
async function checkSharedQuizFromUrl() {
    // 1. Kiểm tra xem trên URL có biến ?uid=...&id=... không
    const urlParams = new URLSearchParams(window.location.search);
    const sharedUid = urlParams.get('uid');
    const sharedId = urlParams.get('id');

    if (sharedUid && sharedId) {
        try {
            console.log("🔍 Đang tải đề thi được chia sẻ...");
            const docRef = db.collection('users').doc(sharedUid).collection('quizzes').doc(sharedId);
            const docSnap = await docRef.get();

            if (docSnap.exists) {
                const quizData = docSnap.data();
                
                // 2. Nạp dữ liệu vào ứng dụng
                state.questions = quizData.questions;
                state.currentQuizId = sharedId;
                state.currentIndex = 0;
                state.isSubmitted = false;

                alert(`🎉 Đã mở đề thi được chia sẻ: "${quizData.title || 'Đề thi trắc nghiệm'}"\nSố câu hỏi: ${quizData.totalQuestions} câu.`);

                // 3. Chuyển thẳng sang màn hình danh sách câu hỏi để làm bài
                renderPreview();
                switchSection('preview-section');
                return true; // Xác nhận đã tải qua link chia sẻ
            } else {
                alert("❌ Đề thi này không còn tồn tại hoặc đường link bị sai!");
            }
        } catch (error) {
            console.error("Lỗi tải đề thi chia sẻ:", error);
            alert("❌ Không thể mở đề thi được chia sẻ: " + error.message);
        }
    }
    return false;
}