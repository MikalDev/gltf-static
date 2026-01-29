const C3 = globalThis.C3
  , glMatrix = globalThis.glMatrix
  , vec3 = glMatrix.vec3
  , quat = glMatrix.quat
  , mat4 = glMatrix.mat4
  , VALID_COLOR_MODES = ["texture", "buffer", "instance"];
globalThis.AnimatedMesh = class {
    #t = null;
    #e = new Map;
    #a = new Map;
    #i = null;
    #s = null;
    #r = null;
    #n = "";
    #o = 0;
    #h = null;
    #l = null;
    #m = null;
    #u = null;
    #d = null;
    #c = null;
    #x = "texture";
    #D = null;
    #M = null;
    #N = null;
    #g = null;
    #p = null;
    #f = null;
    #G = vec3.create();
    #C = vec3.create();
    #A = vec3.create();
    #w = quat.create();
    #B = quat.create();
    #T = quat.create();
    #V = [[NaN, NaN, NaN], [NaN, NaN, NaN], [NaN, NaN, NaN], [NaN, NaN, NaN], [NaN, NaN, NaN], [NaN, NaN, NaN], [NaN, NaN, NaN], [NaN, NaN, NaN]];
    #b = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    #S = [[NaN, NaN], [NaN, NaN], [NaN, NaN], [NaN, NaN], [NaN, NaN], [NaN, NaN], [NaN, NaN], [NaN, NaN], [NaN, NaN], [NaN, NaN], [NaN, NaN], [NaN, NaN]];
    #k = mat4.create();
    #v = mat4.create();
    #I = mat4.create();
    #q = mat4.create();
    #P = mat4.create();
    #U = vec3.create();
    #y = null;
    #F = quat.create();
    #z = quat.create();
    #R = quat.create();
    #W = quat.create();
    #Q = vec3.fromValues(1, 0, 0);
    #E = vec3.fromValues(0, 1, 0);
    #X = vec3.fromValues(0, 0, 1);
    #Y = new C3.Color(0,0,0,1);
    #j = new C3.Color(0,0,0,1);
    #Z = !1;
    #O = !1;
    #L = !0;
    #H = null;
    constructor(t, e, a) {
        this.#t = t,
        this.#i = e,
        this.#s = a,
        this.#r = null,
        this.#n = "",
        this.#o = 0,
        this.#h = this.#t.GetVertexData(),
        this.#D = new this.#h.constructor(this.#h.length),
        this.#l = this.#t.GetSkinIndexData(),
        this.#m = this.#t.GetSkinWeigthData(),
        this.#u = this.#t.GetBoneData(),
        this.#c = this.#t.GetBoneInverseMatricesData(),
        this.#d = this.#t.GetBoneBindPoseData(),
        this.#e = this.#t.GetAnimationsMap(),
        this.#u && (this.#y = new Array(this.#u.length)),
        this.#f = this.#t.GetModel3dTexture()
    }
    Release() {
        this.#Z || (this.#Z = !0,
        this.#t && this.#t.Release(),
        this.#t = null,
        this.#H && this.#H.Release(),
        this.#H = null,
        this.#i = null,
        this.#e = null,
        this.#r = null,
        this.#n = null,
        this.#h = null,
        this.#N = null,
        this.#g = null,
        this.#p = null,
        this.#l = null,
        this.#m = null,
        this.#c = null,
        this.#d = null,
        this.#u = null,
        this.#D = null,
        this.#M = null,
        this.#f = null,
        this.#G = null,
        this.#C = null,
        this.#A = null,
        this.#w = null,
        this.#B = null,
        this.#T = null,
        this.#V = null,
        this.#b = null,
        this.#S = null,
        this.#k = null,
        this.#v = null,
        this.#I = null,
        this.#q = null,
        this.#U = null,
        this.#F = null,
        this.#z = null,
        this.#R = null,
        this.#W = null,
        this.#Q = null,
        this.#E = null,
        this.#X = null)
    }
    OnCreate() {
        if (this.#u)
            if (this.#t.IsSkinned())
                for (const [t,e] of this.#e.entries())
                    this.#a.set(t, []),
                    e.GetTracks().forEach(e => {
                        const [a,i] = e.GetName().split(".");
                        let s = this.#u.find(t => t.GetName() === a)
                          , r = e.GetLookupUUID();
                        s || (s = this.#u.find(t => t.GetId() === r)),
                        (s || (s = this.#s.GetAllObjectsDataMap().get(r),
                        s)) && this.#a.get(t).push({
                            object3d: s,
                            transform: i,
                            track: e
                        })
                    }
                    );
            else
                for (const [t,e] of this.#e.entries())
                    this.#a.set(t, []),
                    e.GetTracks().forEach(e => {
                        const [a,i] = e.GetName().split(".");
                        if (a === this.#t.GetName())
                            this.#a.get(t).push({
                                object3d: this.#t,
                                transform: i,
                                track: e
                            });
                        else {
                            const a = this.#s.GetAllObjectsDataMap().get(e.GetLookupUUID());
                            a && a.GetId() === this.#t.GetId() && this.#a.get(t).push({
                                object3d: this.#t,
                                transform: i,
                                track: e
                            })
                        }
                    }
                    )
    }
    WasReleased() {
        return this.#Z
    }
    GetName() {
        return this.#t.GetName()
    }
    GetInstance() {
        return this.#i
    }
    *animations() {
        if (this.#e)
            for (const t of this.#e.values())
                yield t
    }
    GetCurrentAnimation() {
        return this.#r
    }
    GetCurrentAnimationName() {
        return this.#n
    }
    GetModel3dTexture() {
        return this.#f
    }
    GetRenderType() {
        return this.#t.GetRenderType()
    }
    SetTime(t) {
        this.#o = t
    }
    GetTime() {
        return this.#o
    }
    Play(t, e=0, a=!1) {
        t && (this.#n !== t || a) && (this.#r = this.#e.get(t),
        this.#n = t,
        this.#r ? (e < 0 && (e = 0),
        e > this.#r.GetDuration() && (e = this.#r.GetDuration()),
        this.#o = e) : this.#o = e,
        this.SetAnimationAtTime(this.#o, !0))
    }
    SetAnimationAtTime(t, e=!1) {
        (t !== this.#o || e) && (this.#u && this.#u.forEach( (t, e) => {
            t.SetPosition(this.#d[e].GetPosition()),
            t.SetQuaternion(this.#d[e].GetQuaternion()),
            t.SetScale(this.#d[e].GetScale())
        }
        ),
        this.UpdateAnimation(0, t, !!e))
    }
    UpdateAnimation(t, e=void 0, a=!1) {
        if (!this.#r) {
            if (!this.#e)
                return;
            if (this.#r = this.#e.get(this.#n),
            !this.#r)
                return
        }
        const i = this.#o;
        if (C3.IsFiniteNumber(e) ? this.#o = e : this.#o = (this.#o + t) % this.#r.GetDuration(),
        i !== this.#o || a)
            if (this.#t.IsSkinned()) {
                for (const t of this.#a.get(this.#n)) {
                    const e = t.object3d
                      , a = t.transform
                      , i = t.track
                      , s = this.#_(i, this.#o);
                    e.SetTransform(a, s)
                }
                this.#u.forEach(t => t.UpdateWorldMatrix(!0));
                const t = this.#t.GetBindMatrix()
                  , e = this.#t.GetBindMatrixInverse();
                for (let a = 0; a < this.#u.length; a++) {
                    const i = this.#u[a].GetWorldMatrix()
                      , s = this.#c[a];
                    C3.mat4FromArray(this.#P, s);
                    const r = mat4.create();
                    t && e ? mat4.multiply(r, e, i) : mat4.copy(r, i),
                    mat4.multiply(r, r, this.#P),
                    this.#y[a] = r
                }
                const a = this.#h.length / 3;
                for (let t = 0; t < a; t++) {
                    C3.vec3FromArray(this.#G, this.#h, 3 * t),
                    vec3.set(this.#C, 0, 0, 0);
                    const e = 4 * t;
                    for (let t = 0; t < 4; t++) {
                        const a = this.#m[e + t];
                        if (0 === a)
                            continue;
                        const i = this.#l[e + t]
                          , s = this.#y[i];
                        vec3.transformMat4(this.#A, this.#G, s),
                        vec3.scaleAndAdd(this.#C, this.#C, this.#A, a)
                    }
                    C3.vec3ToArray(this.#C, this.#D, 3 * t)
                }
            } else {
                for (const t of this.#a.get(this.#n)) {
                    const e = t.object3d
                      , a = t.transform
                      , i = t.track
                      , s = this.#_(i, this.#o);
                    e.SetTransform(a, s)
                }
                this.#t.UpdateWorldMatrix(!0),
                this.#D = this.#h
            }
    }
    DrawMesh(t, e) {
        e.sdkInstance = this.#i.GetSdkInstance ? this.#i.GetSdkInstance() : null;
        const a = this.#f.GetTexture(e?.runtime, t, e);
        if (e?.updateVertexData && this.UpdateVertexData(e),
        a && "texture" === this.#f.GetContentType() ? (t.SetTextureFillMode(),
        t.SetTexture(a, this.#i.GetActiveSampling() ?? 0),
        this.#J(this.#i.GetColor ? this.#i.GetColor() : this.#i.GetUnpremultipliedColor()),
        t.DrawMeshData(this.#H)) : this.#t.GetColorData() ? (t.SetColorFillMode(),
        t.SetTexture(null),
        t.ResetColor(),
        this.#J(this.#i.GetColor ? this.#i.GetColor() : this.#i.GetUnpremultipliedColor()),
        t.DrawMeshData(this.#H)) : !this.#f.GetColor() || this.#f.HadTextureError(e) || this.#f.IsLoadingTexture(e) ? this.#f.HadTextureError(e) ? (t.SetColorFillMode(),
        t.SetTexture(null),
        t.SetColorRgba(.25, 0, 0, .25),
        t.DrawMeshData(this.#H)) : (t.SetColorFillMode(),
        t.SetTexture(null),
        t.SetColorRgba(0, 0, .1, .1),
        t.DrawMeshData(this.#H)) : (t.SetColorFillMode(),
        t.SetTexture(null),
        this.#K(),
        t.DrawMeshData(this.#H)),
        e.showBoundingBox) {
            t.SetColorFillMode(),
            t.SetTexture(null),
            t.SetColor(e.boundingBoxColor);
            for (const e of this.GetBoundingBoxForDrawing(this.#H.positions))
                t.Line3D(e[0][0], e[0][1], e[0][2], e[1][0], e[1][1], e[1][2])
        }
    }
    MaybeCreateMeshData(t) {
        if (this.#H)
            return;
        const e = this.#t.GetIndexData()
          , a = e ? e.length : this.#h.length / 3;
        this.#H = t.CreateMeshData(this.#h.length / 3, a, {
            staticPositions: !1,
            staticTexCoords: !1,
            staticColors: !1,
            staticIndices: !0
        }),
        this.#H.CreateGPUResources();
        const i = this.#t.GetUVData();
        if (i) {
            for (let t = 0; t < i.length; t++)
                this.#H.texCoords[t] = i[t];
            this.#H.MarkTexCoordsDataChanged()
        }
        if (e)
            for (let t = 0; t < e.length; t++)
                this.#H.indices[t] = e[t];
        else
            for (let t = 0; t < this.#H.indices.length; t++)
                this.#H.indices[t] = t;
        this.#H.MarkIndexDataChanged()
    }
    #K() {
        const t = this.#f.GetColor();
        this.#j.equals(t) && "texture" === this.#x || (this.#j.set(t),
        this.#x = "texture",
        this.#H.FillColor(t.r, t.g, t.b, t.a),
        this.#H.MarkColorsDataChanged())
    }
    #J(t) {
        if (this.#t.GetColorData()) {
            if (this.#j.equals(t) && "buffer" === this.#x)
                return;
            this.#j.set(t),
            this.#x = "buffer";
            const e = this.#t.GetColorData()
              , a = this.#H.colors;
            for (let i = 0; i < e.length; i += 4)
                a[i + 0] = e[i + 0] * t.r,
                a[i + 1] = e[i + 1] * t.g,
                a[i + 2] = e[i + 2] * t.b,
                a[i + 3] = e[i + 3] * t.a;
            this.#H.MarkColorsDataChanged()
        } else {
            if (this.#j.equals(t) && "instance" === this.#x)
                return;
            this.#j.set(t),
            this.#x = "instance",
            this.#H.FillColor(t.r, t.g, t.b, t.a),
            this.#H.MarkColorsDataChanged()
        }
    }
    UpdateVertexData(t) {
        let e, a, i;
        t?.useOwnNormalizationMatrix ? (e = this.#$(),
        a = this.#tt(),
        i = this.#et()) : (e = this.#s.GetNormalizationMatrix(),
        a = this.#s.GetPivotUpMatrix(),
        i = this.#s.GetNormalizationAspect());
        const s = this.#i.GetWidth()
          , r = this.#i.GetHeight()
          , n = this.#i.GetX() + (t?.positionX ?? 0)
          , o = this.#i.GetY() + (t?.positionY ?? 0)
          , h = this.#i.GetTotalZElevation() + (t?.positionZ ?? 0)
          , l = Math.min(s / i.x, r / i.y)
          , m = t?.scaleX ?? 1
          , u = t?.scaleY ?? 1
          , d = t?.scaleZ ?? 1;
        this.#i.SetDepth(l * d),
        C3.makeScaleMatrix(mat4, this.#k, l * m, l * u, l * d),
        C3.makeTranslateMatrix(mat4, this.#I, n, o, h),
        quat.setAxisAngle(this.#F, this.#Q, t?.rotationX ?? 0),
        quat.setAxisAngle(this.#z, this.#E, t?.rotationY ?? 0),
        quat.setAxisAngle(this.#R, this.#X, t?.rotationZ ?? 0),
        quat.multiply(this.#W, this.#R, this.#z),
        quat.multiply(this.#W, this.#W, this.#F),
        mat4.fromQuat(this.#v, this.#W),
        mat4.copy(this.#q, this.#I),
        mat4.multiply(this.#q, this.#q, this.#k),
        mat4.multiply(this.#q, this.#q, a),
        mat4.multiply(this.#q, this.#q, this.#v),
        mat4.multiply(this.#q, this.#q, e),
        this.#t.IsSkinned() || mat4.multiply(this.#q, this.#q, this.#t.GetWorldMatrix());
        const c = this.#t.IsSkinned() ? this.#D : this.#h
          , x = c.length / 3;
        for (let t = 0; t < x; t++)
            C3.vec3FromArray(this.#U, c, 3 * t),
            vec3.transformMat4(this.#U, this.#U, this.#q),
            C3.vec3ToArray(this.#U, this.#H.positions, 3 * t);
        this.#H.MarkPositionDataChanged()
    }
    GetRawVertexData() {
        return this.#h
    }
    GetSkinnedVertexData() {
        return this.#D
    }
    GetWorldVertexData() {
        if (this.#N && this.#M)
            return this.#M;
        this.#M || (this.#M = new this.#h.constructor(this.#h.length));
        const t = vec3.create();
        for (let e = 0; e < this.#h.length; e += 3)
            vec3.set(t, this.#h[e], this.#h[e + 1], this.#h[e + 2]),
            vec3.transformMat4(t, t, this.#t.GetWorldMatrix()),
            C3.vec3ToArray(t, this.#M, e);
        return this.#M
    }
    GetTransformedVertexData() {
        return this.#H.positions
    }
    IsSkinned() {
        return this.#t.IsSkinned()
    }
    InvalidateUV() {
        this.#L = !0
    }
    GetUVData() {
        if (this.#L) {
            if (!this.#f.IsContentReady())
                return this.#H.texCoords;
            const t = this.#f.GetSpriteSheetWidth()
              , e = this.#f.GetSpriteSheetHeight();
            if (!C3.IsFiniteNumber(t) || !C3.IsFiniteNumber(e))
                return this.#H.texCoords;
            this.#L = !1;
            const a = this.#H.texCoords
              , i = this.#f.GetSpriteSheetOffsetX()
              , s = this.#f.GetSpriteSheetOffsetY()
              , r = this.#f.GetWidthInSpriteSheet()
              , n = this.#f.GetHeightInSpriteSheet();
            for (let o = 0; o < a.length; o += 2) {
                const h = a[o + 0]
                  , l = a[o + 1];
                a[o + 0] = i / t + h * (r / t),
                a[o + 1] = s / e + l * (n / e)
            }
            return this.#H.MarkTexCoordsDataChanged(),
            a
        }
        return this.#H.texCoords
    }
    GetIndexData() {
        return this.#H.indices
    }
    GetColorData() {
        return this.#H.colors
    }
    GetBoundingBoxMid(t) {
        let e = 1 / 0
          , a = 1 / 0
          , i = 1 / 0
          , s = -1 / 0
          , r = -1 / 0
          , n = -1 / 0;
        for (let o = 0; o < t.length; o += 3) {
            const h = t[o]
              , l = t[o + 1]
              , m = t[o + 2];
            h < e && (e = h),
            h > s && (s = h),
            l < a && (a = l),
            l > r && (r = l),
            m < i && (i = m),
            m > n && (n = m)
        }
        return [(e + s) / 2, (a + r) / 2, (i + n) / 2]
    }
    GetBoundingBoxForDrawing(t) {
        let e = 1 / 0
          , a = 1 / 0
          , i = 1 / 0
          , s = -1 / 0
          , r = -1 / 0
          , n = -1 / 0;
        for (let o = 0; o < t.length; o += 3) {
            const h = t[o]
              , l = t[o + 1]
              , m = t[o + 2];
            h < e && (e = h),
            h > s && (s = h),
            l < a && (a = l),
            l > r && (r = l),
            m < i && (i = m),
            m > n && (n = m)
        }
        this.#V[0][0] = e,
        this.#V[0][1] = a,
        this.#V[0][2] = i,
        this.#V[1][0] = s,
        this.#V[1][1] = a,
        this.#V[1][2] = i,
        this.#V[2][0] = s,
        this.#V[2][1] = r,
        this.#V[2][2] = i,
        this.#V[3][0] = e,
        this.#V[3][1] = r,
        this.#V[3][2] = i,
        this.#V[4][0] = e,
        this.#V[4][1] = a,
        this.#V[4][2] = n,
        this.#V[5][0] = s,
        this.#V[5][1] = a,
        this.#V[5][2] = n,
        this.#V[6][0] = s,
        this.#V[6][1] = r,
        this.#V[6][2] = n,
        this.#V[7][0] = e,
        this.#V[7][1] = r,
        this.#V[7][2] = n;
        for (let t = 0; t < this.#b.length; t++) {
            const e = this.#b[t];
            this.#S[t][0] = this.#V[e[0]],
            this.#S[t][1] = this.#V[e[1]]
        }
        return this.#S
    }
    #_(t, e) {
        const a = t.GetTimes()
          , i = t.GetValues()
          , s = i.length / a.length;
        let r = 0;
        for (; r < a.length - 1 && e > a[r + 1]; )
            r++;
        if (r >= a.length - 1)
            return i.slice(i.length - s);
        const n = a[r]
          , o = (e - n) / (a[r + 1] - n)
          , h = i.slice(r * s, (r + 1) * s)
          , l = i.slice((r + 1) * s, (r + 2) * s);
        return 3 === s ? h.map( (t, e) => t * (1 - o) + l[e] * o) : 4 === s ? (C3.quatFromArray(this.#w, h),
        C3.quatFromArray(this.#B, l),
        quat.slerp(this.#T, this.#w, this.#B, o),
        this.#T) : void 0
    }
    #$() {
        if (this.#N)
            return this.#N;
        const t = this.#t.IsSkinned() ? this.GetSkinnedVertexData() : this.GetWorldVertexData();
        let e = 1 / 0
          , a = 1 / 0
          , i = 1 / 0
          , s = -1 / 0
          , r = -1 / 0
          , n = -1 / 0;
        for (let o = 0; o < t.length; o += 3) {
            const h = t[o]
              , l = t[o + 1]
              , m = t[o + 2];
            h < e && (e = h),
            l < a && (a = l),
            m < i && (i = m),
            h > s && (s = h),
            l > r && (r = l),
            m > n && (n = m)
        }
        const o = (e + s) / 2
          , h = (a + r) / 2
          , l = (i + n) / 2
          , m = s - e
          , u = r - a
          , d = n - i
          , c = Math.max(m, u, d)
          , x = 1 / c
          , D = mat4.create();
        C3.makeScaleMatrix(mat4, D, x, x, x);
        const M = mat4.create();
        return C3.makeTranslateMatrix(mat4, M, -o, -h, -l),
        this.#N = mat4.multiply(mat4.create(), D, M),
        this.#g = {
            x: m / c,
            y: u / c,
            z: d / c
        },
        this.#p = mat4.create(),
        C3.makeTranslateMatrix(mat4, this.#p, 0, 0, .5 * this.#g.z),
        this.#N
    }
    #et() {
        return this.#$(),
        this.#g
    }
    #tt() {
        return this.#$(),
        this.#p
    }
}
;
