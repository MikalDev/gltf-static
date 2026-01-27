{
    const t = self.C3;
    t.Plugins.Model3D = class extends t.SDKPluginBase {
        constructor(t) {
            super(t)
        }
        Release() {
            super.Release()
        }
    }
}
{
    const t = self.C3;
    t.Plugins.Model3D.Type = class extends t.SDKTypeBase {
        constructor(t) {
            super(t)
        }
        Release() {
            super.Release()
        }
    }
}
{
    const t = self.C3
      , e = self.C3X
      , i = 0
      , s = 1
      , a = 2
      , n = 3
      , o = 4
      , r = 5
      , h = 6
      , _ = 7
      , l = 8
      , d = 9
      , m = 10
      , u = 11
      , c = 12
      , p = 13
      , M = 14
      , g = 15
      , S = 16
      , G = 17
      , R = 18
      , f = 0;
    t.Plugins.Model3D.Instance = class extends t.SDKWorldInstanceBase {
        constructor(e, b) {
            super(e),
            this._model3dName = "",
            this._positionX = 0,
            this._positionY = 0,
            this._positionZ = 0,
            this._rotationX = 0,
            this._rotationY = 0,
            this._rotationZ = 0,
            this._scaleX = 1,
            this._scaleY = 1,
            this._scaleZ = 1,
            this._meshName = "",
            this._animationName = "",
            this._initiallyPlaying = !0,
            this._initialAnimationProgress = 0,
            this._boundingBox = !1,
            this._boundingBoxColor = null,
            this._meshRenderMode = f,
            b && (this._model3dName = b[i],
            this._positionX = b[a],
            this._positionY = b[n],
            this._positionZ = b[o],
            this._rotationX = t.toRadians(b[r]),
            this._rotationY = t.toRadians(b[h]),
            this._rotationZ = t.toRadians(b[_]),
            this._scaleX = b[l],
            this._scaleY = b[d],
            this._scaleZ = b[m],
            this._meshName = b[u],
            this._animationName = b[c],
            this._initiallyPlaying = b[M],
            this._initialAnimationProgress = b[g],
            this._boundingBox = b[G],
            this._boundingBoxColor = b[R],
            this._meshRenderMode = b[p]),
            this._animatedModel = null,
            this._drawParams = {
                dt: NaN,
                runtimeMode: "draw",
                animationPlaying: !1,
                runtime: null
            },
            this._isPlayingAnimation = !1,
            this._timelineTick = !1,
            this._model3dName && this._LoadFile(this._model3dName, this._meshName, this._animationName, this._initiallyPlaying, this._initialAnimationProgress, !0);
            const P = this.GetWorldInfo();
            P.SetVisible(b?.[s] ?? !0),
            P.SetCollisionEnabled(b?.[S] ?? !0),
            P.SetBboxChanged(),
            this._meshLoop = {
                indexes: [],
                depth: -1
            },
            this._animationLoop = {
                indexes: [],
                depth: -1
            }
        }
        Release() {
            this._animatedModel && (this._animatedModel.Release(),
            this._animatedModel = null),
            t.clearArray(this._meshLoop.indexes),
            this._meshLoop.indexes = null,
            this._meshLoop = null,
            t.clearArray(this._animationLoop.indexes),
            this._animationLoop.indexes = null,
            this._animationLoop = null,
            this._drawParams = null,
            this._projectFileStub = null,
            super.Release()
        }
        GetAnimatedModel() {
            return this._animatedModel
        }
        IsOriginalSizeKnown() {
            return !0
        }
        *animationObjects() {
            this._animatedModel && (yield*this._animatedModel.animationObjects())
        }
        _SetMesh(t=void 0) {
            this._animatedModel && this._animatedModel.SetMesh(t || "@all")
        }
        _GetName() {
            return this._animatedModel ? this._model3dName : ""
        }
        _GetMesh() {
            return this._animatedModel ? this._animatedModel.GetCurrentMeshName() : ""
        }
        _GetMeshCount() {
            return this._animatedModel ? [...this._animatedModel.meshes(!1)].length : 0
        }
        _GetMeshAt(t) {
            return this._animatedModel ? [...this._animatedModel.meshes(!1)][t] ?? "" : ""
        }
        _SetMeshRenderMode(t) {
            this._meshRenderMode = t
        }
        _SetAnimation(e=void 0, i=!1, s=0, a=!1) {
            if (this._animatedModel) {
                if (e = e || this._animatedModel.GetCurrentAnimationName()) {
                    const i = t.clamp(s || 0, 0, 1)
                      , n = this._GetAnimationByNameDuration(e)
                      , o = "number" == typeof n ? i * n : 0;
                    this._animatedModel.Play(e, o, a)
                } else
                    this._animatedModel.Play(e, 0, a);
                this._initialAnimationProgress = s,
                this._isPlayingAnimation = !!i
            }
        }
        _GetAnimation() {
            return this._animatedModel ? this._animatedModel.GetCurrentAnimationName() : ""
        }
        _GetAnimationsCount() {
            return this._animatedModel ? [...this._animatedModel.animations()].length : 0
        }
        _GetAnimationAt(t) {
            return this._animatedModel ? [...this._animatedModel.animations()][t] ?? "" : ""
        }
        _SetProgress(t=0) {
            this._initialAnimationProgress = t,
            this._animatedModel && this._SetAnimation(this._animatedModel.GetCurrentAnimationName(), this._isPlayingAnimation, this._initialAnimationProgress, !0)
        }
        _SetPosition(t, e, i, s=0) {
            switch (s) {
            case 0:
                this._positionX = t,
                this._positionY = e,
                this._positionZ = i;
                break;
            case 1:
                this._positionX += t,
                this._positionY += e,
                this._positionZ += i;
                break;
            case 2:
                this._positionX -= t,
                this._positionY -= e,
                this._positionZ -= i;
                break;
            case 3:
                this._positionX *= t,
                this._positionY *= e,
                this._positionZ *= i;
                break;
            case 4:
                this._positionX /= t,
                this._positionY /= e,
                this._positionZ /= i
            }
            this._runtime.UpdateRender()
        }
        _SetRotation(e, i, s, a=0) {
            let n = e
              , o = i
              , r = s;
            switch (a) {
            case 0:
                this._rotationX = n,
                this._rotationY = o,
                this._rotationZ = r;
                break;
            case 1:
                this._rotationX += n,
                this._rotationY += o,
                this._rotationZ += r;
                break;
            case 2:
                this._rotationX -= n,
                this._rotationY -= o,
                this._rotationZ -= r;
                break;
            case 3:
                this._rotationX *= n,
                this._rotationY *= o,
                this._rotationZ *= r;
                break;
            case 4:
                this._rotationX /= n,
                this._rotationY /= o,
                this._rotationZ /= r
            }
            this._rotationX = t.clampAngle(this._rotationX),
            this._rotationY = t.clampAngle(this._rotationY),
            this._rotationZ = t.clampAngle(this._rotationZ),
            this._runtime.UpdateRender()
        }
        _SetScale(t, e, i, s=0) {
            switch (s) {
            case 0:
                this._scaleX = t,
                this._scaleY = e,
                this._scaleZ = i;
                break;
            case 1:
                this._scaleX += t,
                this._scaleY += e,
                this._scaleZ += i;
                break;
            case 2:
                this._scaleX -= t,
                this._scaleY -= e,
                this._scaleZ -= i;
                break;
            case 3:
                this._scaleX *= t,
                this._scaleY *= e,
                this._scaleZ *= i;
                break;
            case 4:
                this._scaleX /= t,
                this._scaleY /= e,
                this._scaleZ /= i
            }
            this._runtime.UpdateRender()
        }
        _Play(t=void 0, e=0) {
            this._SetAnimation(t, !0, e, !0)
        }
        _Stop() {
            if (!this._animatedModel)
                return;
            const t = this._animatedModel.GetCurrentAnimationName();
            this._SetAnimation(t, !1, 0, !0)
        }
        _Pause() {
            if (!this._animatedModel)
                return;
            const t = this._animatedModel.GetCurrentAnimationName()
              , e = this._GetAnimationByNameProgress(t);
            this._SetAnimation(t, !1, e, !0)
        }
        _Resume() {
            if (!this._animatedModel)
                return;
            const t = this._animatedModel.GetCurrentAnimationName()
              , e = this._GetAnimationByNameProgress(t);
            this._SetAnimation(t, !0, e, !0)
        }
        _GetModelFileName() {
            return this._model3dName
        }
        _GetAllMeshes(t=!1) {
            return this._animatedModel ? [...this._animatedModel.meshes(t)] : []
        }
        _GetAllAnimations() {
            return this._animatedModel ? [...this._animatedModel.animations()] : []
        }
        _GetProgress() {
            const t = this._animatedModel?.GetCurrentAnimationName();
            return t ? this._GetAnimationByNameProgress(t) : 0
        }
        _GetAnimationDuration(t) {
            return this._GetAnimationByNameDuration(t)
        }
        _IsPlaying() {
            return this._isPlayingAnimation
        }
        _SetPlaying(t) {
            this._isPlayingAnimation = !!t
        }
        _GetMeshRenderMode() {
            return 0 === this._meshRenderMode ? "hierarchy" : 1 === this._meshRenderMode ? "isolate" : void 0
        }
        _GetModel3dDataItem() {
            return this._runtime.GetModel3dManager().GetModel3dDataItemByName(this._model3dName)
        }
        _LoadFile(e, i=void 0, s=void 0, a=!1, n=0, o=!1, r=null, h=null) {
            if (this._model3dName !== e || o) {
                this._animatedModel && (this._animatedModel.Release(),
                this._animatedModel = null);
                try {
                    this._model3dName = e;
                    const h = this._GetModel3dDataItem();
                    this._animatedModel = new globalThis.AnimatedModel(new globalThis.AnimatedModelData(h),this._inst.GetWorldInfo(),i,s),
                    this._SetMesh(i),
                    this._SetAnimation(s, a, n, o),
                    this.IsTicking() || this._StartTicking(),
                    globalThis.requestAnimationFrame( () => {
                        const e = this.GetRuntime();
                        e && this._inst && (e.Trigger(t.Plugins.Model3D.Cnds.OnLoadModel, this._inst),
                        r && r())
                    }
                    )
                } catch (i) {
                    t.Plugins.Model3D.Exps.SetLastErrorModel3dName(e, this),
                    this.GetRuntime().Trigger(t.Plugins.Model3D.Cnds.OnLoadModelFail, this._inst),
                    this._animatedModel && (this._animatedModel.Release(),
                    this._animatedModel = null),
                    h && h()
                }
            }
        }
        _GetAnimationByNameDuration(t) {
            for (const e of this.animationObjects())
                if (t === e.GetName())
                    return e.GetDuration();
            return 0
        }
        _GetAnimationByNameProgress(t) {
            if (!this._animatedModel)
                return 0;
            const e = this._GetAnimationByNameDuration(t);
            if (void 0 === e)
                return 0;
            return this._animatedModel.GetTime() / e
        }
        RendersToOwnZPlane() {
            return !1
        }
        Draw(t) {
            this._animatedModel && (this._drawParams.runtimeMode = "draw",
            this._drawParams.dt = NaN,
            this._drawParams.animationPlaying = !1,
            this._drawParams.runtime = this._runtime,
            this._animatedModel.Update(t, this._drawParams, this._meshRenderMode, !1, 0, this._rotationX, this._rotationY, this._rotationZ + this.GetWorldInfo().GetAngle(), 0, !1))
        }
        Tick() {
            if (!this._animatedModel)
                return;
            this._drawParams.runtimeMode = "update",
            this._drawParams.dt = this.GetRuntime().GetDt(this._inst),
            this._drawParams.animationPlaying = this._isPlayingAnimation,
            this._drawParams.runtime = this._runtime;
            const e = this._animatedModel.GetCurrentAnimationName()
              , i = t.clamp(this._initialAnimationProgress, 0, 1)
              , s = this._GetAnimationByNameDuration(e)
              , a = "number" == typeof s ? i * s : 0;
            this._animatedModel.Update(this._runtime.GetRenderer(), this._drawParams, this._meshRenderMode, !1, 0, this._positionX, this._positionY, this._positionZ, this._rotationX, this._rotationY, this._rotationZ + this.GetWorldInfo().GetAngle(), this._scaleX, this._scaleY, this._scaleZ, a, this._timelineTick),
            this._runtime.UpdateRender(),
            this._timelineTick = !1
        }
        MustPreDraw() {
            return !1
        }
        SaveToJson() {
            return {
                "m3d": this._model3dName,
                "px": this._positionX,
                "py": this._positionY,
                "pz": this._positionZ,
                "rx": this._rotationX,
                "ry": this._rotationY,
                "rz": this._rotationZ,
                "sx": this._scaleX,
                "sy": this._scaleY,
                "sz": this._scaleZ,
                "mn": this._GetMesh(),
                "an": this._GetAnimation(),
                "iap": this._initialAnimationProgress,
                "cap": this._GetProgress(),
                "bb": this._boundingBox,
                "bbc": this._boundingBoxColor,
                "pa": this._IsPlaying()
            }
        }
        LoadFromJson(t) {
            this._StopTicking(),
            this._model3dName = t["m3d"],
            this._positionX = t["px"],
            this._positionY = t["py"],
            this._positionZ = t["pz"],
            this._rotationX = t["rx"],
            this._rotationY = t["ry"],
            this._rotationZ = t["rz"],
            this._scaleX = t["sx"],
            this._scaleY = t["sy"],
            this._scaleZ = t["sz"],
            this._meshName = t["mn"],
            this._animationName = t["an"],
            this._initialAnimationProgress = t["iap"],
            this._boundingBox = t["bb"],
            this._boundingBoxColor = t["bbc"],
            this._isPlayingAnimation = t["pa"],
            this._LoadFile(this._model3dName, this._meshName, this._animationName, this._isPlayingAnimation, t["cap"], !0)
        }
        GetPropertyValueByIndex(t) {
            switch (t) {
            case a:
                return this._positionX;
            case n:
                return this._positionY;
            case o:
                return this._positionZ;
            case r:
                return this._rotationX;
            case h:
                return this._rotationY;
            case _:
                return this._rotationZ;
            case l:
                return this._scaleX;
            case d:
                return this._scaleY;
            case m:
                return this._scaleZ;
            case u:
                return this._meshName;
            case c:
                return this._animationName;
            case g:
                return this._initialAnimationProgress;
            case S:
                return this.GetWorldInfo().IsCollisionEnabled();
            case p:
                return this._meshRenderMode
            }
        }
        SetPropertyValueByIndex(t, e) {
            switch (t) {
            case a:
                this._positionX = e;
                break;
            case n:
                this._positionY = e;
                break;
            case o:
                this._positionZ = e;
                break;
            case r:
                this._rotationX = e;
                break;
            case h:
                this._rotationY = e;
                break;
            case _:
                this._rotationZ = e;
                break;
            case l:
                this._scaleX = e;
                break;
            case d:
                this._scaleY = e;
                break;
            case m:
                this._scaleZ = e;
                break;
            case u:
                this._meshName = e,
                this._animatedModel && this._animatedModel.SetMesh(this._meshName);
                break;
            case c:
                this._animationName = e,
                this._animatedModel && this._animatedModel.Play(this._animationName);
                break;
            case g:
                this._initialAnimationProgress = e,
                this._timelineTick = !0;
                break;
            case S:
                this.GetWorldInfo().SetCollisionEnabled(e);
                break;
            case p:
                this._meshRenderMode = e
            }
        }
        _GetForIndex(t) {
            switch (t) {
            case "mesh":
                return this._meshLoop.depth >= 0 && this._meshLoop.depth < this._meshLoop.indexes.length ? this._meshLoop.indexes[this._meshLoop.depth] : 0;
            case "animation":
                return this._animationLoop.depth >= 0 && this._animationLoop.depth < this._animationLoop.indexes.length ? this._animationLoop.indexes[this._animationLoop.depth] : 0
            }
        }
        GetScriptInterfaceClass() {
            return self.I3DModelInstance
        }
        GetDebuggerProperties() {
            const e = "plugins.model3d";
            return [{
                title: e + ".name",
                properties: [{
                    name: e + ".properties.3d-model-object.name",
                    type: "list",
                    value: {
                        selected: this._GetModelFileName(),
                        options: P(this._runtime)
                    },
                    onedit: t => this._LoadFile(t)
                }, {
                    name: e + ".properties.mesh.name",
                    type: "list",
                    value: {
                        selected: this._GetMesh(),
                        options: this._GetAllMeshes(!0)
                    },
                    onedit: t => this._SetMesh(t)
                }, {
                    name: e + ".properties.animation.name",
                    type: "list",
                    value: {
                        selected: this._GetAnimation(),
                        options: this._GetAllAnimations()
                    },
                    onedit: t => this._SetAnimation(t)
                }, {
                    name: e + ".properties.mesh-render-mode.name",
                    type: "list",
                    value: {
                        selected: {
                            label: e + ".debugger." + this._GetMeshRenderMode(),
                            value: this._meshRenderMode
                        },
                        options: [{
                            label: e + ".debugger.hierarchy",
                            value: 0
                        }, {
                            label: e + ".debugger.isolate",
                            value: 1
                        }]
                    },
                    onedit: t => {
                        this._SetMeshRenderMode(t)
                    }
                }, {
                    name: e + ".properties.x-position.name",
                    value: this._GetOffsetX(),
                    onedit: t => this._SetPosition(t, this._positionY, this._positionZ)
                }, {
                    name: e + ".properties.y-position.name",
                    value: this._GetOffsetY(),
                    onedit: t => this._SetPosition(this._positionX, t, this._positionZ)
                }, {
                    name: e + ".properties.z-position.name",
                    value: this._GetOffsetZ(),
                    onedit: t => this._SetPosition(this._positionX, this._positionY, t)
                }, {
                    name: e + ".properties.x-rotation.name",
                    value: t.toDegrees(this._GetRotationX()),
                    onedit: e => this._SetRotation(t.toRadians(e), this._rotationY, this._rotationZ)
                }, {
                    name: e + ".properties.y-rotation.name",
                    value: t.toDegrees(this._GetRotationY()),
                    onedit: e => this._SetRotation(this._rotationX, t.toRadians(e), this._rotationZ)
                }, {
                    name: e + ".properties.z-rotation.name",
                    value: t.toDegrees(this._GetRotationZ()),
                    onedit: e => this._SetRotation(this._rotationX, this._rotationY, t.toRadians(e))
                }, {
                    name: e + ".properties.x-scale.name",
                    value: this._GetScaleX(),
                    onedit: t => this._SetScale(t, this._scaleY, this._scaleZ)
                }, {
                    name: e + ".properties.y-scale.name",
                    value: this._GetScaleY(),
                    onedit: t => this._SetScale(this._scaleX, t, this._scaleZ)
                }, {
                    name: e + ".properties.z-scale.name",
                    value: this._GetScaleZ(),
                    onedit: t => this._SetScale(this._scaleX, this._scaleY, t)
                }, {
                    name: e + ".properties.enable-collisions.name",
                    value: this.GetWorldInfo().IsCollisionEnabled(),
                    onedit: t => this.GetWorldInfo().SetCollisionEnabled(t)
                }, {
                    name: e + ".debugger.playing",
                    value: this._IsPlaying()
                }, {
                    name: e + ".debugger.progress",
                    value: this._GetProgress(),
                    onedit: t => this._SetProgress(t)
                }, {
                    name: e + ".debugger.playback-controls",
                    type: "button-array",
                    value: [{
                        name: "▶",
                        translate: !1,
                        onaction: () => this._Play(this._GetAnimation(), 0)
                    }, {
                        name: "⏹",
                        translate: !1,
                        onaction: () => this._Stop()
                    }, {
                        name: "⏸",
                        translate: !1,
                        onaction: () => this._Pause()
                    }, {
                        name: "⏯",
                        translate: !1,
                        onaction: () => this._Resume()
                    }]
                }]
            }]
        }
        _SetOffsetX(t) {
            this._positionX = t,
            this._runtime.UpdateRender()
        }
        _GetOffsetX() {
            return this._positionX
        }
        _SetOffsetY(t) {
            this._positionY = t,
            this._runtime.UpdateRender()
        }
        _GetOffsetY() {
            return this._positionY
        }
        _SetOffsetZ(t) {
            this._positionZ = t,
            this._runtime.UpdateRender()
        }
        _GetOffsetZ() {
            return this._positionZ
        }
        _SetRotationX(e) {
            this._rotationX = e,
            this._rotationX = t.clampAngle(this._rotationX),
            this._runtime.UpdateRender()
        }
        _GetRotationX() {
            return this._rotationX
        }
        _SetRotationY(e) {
            this._rotationY = e,
            this._rotationY = t.clampAngle(this._rotationY),
            this._runtime.UpdateRender()
        }
        _GetRotationY() {
            return this._rotationY
        }
        _SetRotationZ(e) {
            this._rotationZ = e,
            this._rotationZ = t.clampAngle(this._rotationZ),
            this._runtime.UpdateRender()
        }
        _GetRotationZ() {
            return this._rotationZ
        }
        _SetScaleX(t) {
            this._scaleX = t,
            this._runtime.UpdateRender()
        }
        _GetScaleX() {
            return this._scaleX
        }
        _SetScaleY(t) {
            this._scaleY = t,
            this._runtime.UpdateRender()
        }
        _GetScaleY() {
            return this._scaleY
        }
        _SetScaleZ(t) {
            this._scaleZ = t,
            this._runtime.UpdateRender()
        }
        _GetScaleZ() {
            return this._scaleZ
        }
    }
    ;
    let b = null;
    const P = t => {
        if (b)
            return b;
        b = [];
        for (const e of t.GetModel3dManager().GetModel3dDataItems())
            b.push(e.GetName());
        return b
    }
      , A = ["hierarchy", "isolate"]
      , v = ["offset", "rotation", "scale"];
    self.I3DModelInstance = class extends self.IWorldInstance {
        #t;
        constructor() {
            super(),
            this.#t = self.IInstance._GetInitInst().GetSdkInstance()
        }
        loadModel(t, i, s, a, n) {
            e.RequireString(t),
            this.#t._LoadFile(t, i, s, a, n, !1, () => {
                this.onLoad && this.onLoad()
            }
            , () => {
                this.onError && this.onError()
            }
            )
        }
        onLoad() {}
        onError() {}
        set meshRenderMode(t) {
            if (!A.includes(t))
                throw new Error(`invalid mesh render mode '${t}'"`);
            this.#t._SetMeshRenderMode(A.indexOf(t))
        }
        get meshRenderMode() {
            return this.#t._GetMeshRenderMode()
        }
        set modelName(t) {
            this.loadModel(t)
        }
        get modelName() {
            return this.#t._GetName()
        }
        set meshName(t) {
            e.RequireOptionalString(t),
            this.#t._SetMesh(t)
        }
        get meshName() {
            return this.#t._GetMesh()
        }
        set animationName(t) {
            e.RequireString(t),
            this.#t._SetAnimation(t, !1, 0)
        }
        get animationName() {
            return this.#t._GetAnimation()
        }
        set animationProgress(t) {
            e.RequireFiniteNumber(t),
            this.#t._SetProgress(t)
        }
        get animationProgress() {
            return this.#t._GetProgress()
        }
        setTransform(t, i, s, a) {
            switch (e.RequireFiniteNumber(t),
            e.RequireFiniteNumber(i),
            e.RequireFiniteNumber(s),
            e.RequireString(a),
            a) {
            case v[0]:
                this.#t._SetPosition(t, i, s, 0);
                break;
            case v[1]:
                this.#t._SetRotation(t, i, s, 0);
                break;
            case v[2]:
                this.#t._SetScale(t, i, s, 0);
                break;
            default:
                throw new Error(`invalid transform type '${a}')`)
            }
        }
        addTransform(t, i, s, a) {
            switch (e.RequireFiniteNumber(t),
            e.RequireFiniteNumber(i),
            e.RequireFiniteNumber(s),
            e.RequireString(a),
            a) {
            case v[0]:
                this.#t._SetPosition(t, i, s, 1);
                break;
            case v[1]:
                this.#t._SetRotation(t, i, s, 1);
                break;
            case v[2]:
                this.#t._SetScale(t, i, s, 1);
                break;
            default:
                console.warn(`invalid transform type "${a}", valid transform types are: "${v}"`)
            }
        }
        subTransform(t, i, s, a) {
            switch (e.RequireFiniteNumber(t),
            e.RequireFiniteNumber(i),
            e.RequireFiniteNumber(s),
            e.RequireString(a),
            a) {
            case v[0]:
                this.#t._SetPosition(t, i, s, 2);
                break;
            case v[1]:
                this.#t._SetRotation(t, i, s, 2);
                break;
            case v[2]:
                this.#t._SetScale(t, i, s, 2);
                break;
            default:
                console.warn(`invalid transform type "${a}", valid transform types are: "${v}"`)
            }
        }
        mulTransform(t, i, s, a) {
            switch (e.RequireFiniteNumber(t),
            e.RequireFiniteNumber(i),
            e.RequireFiniteNumber(s),
            e.RequireString(a),
            a) {
            case v[0]:
                this.#t._SetPosition(t, i, s, 3);
                break;
            case v[1]:
                this.#t._SetRotation(t, i, s, 3);
                break;
            case v[2]:
                this.#t._SetScale(t, i, s, 3);
                break;
            default:
                console.warn(`invalid transform type "${a}", valid transform types are: "${v}"`)
            }
        }
        divTransform(t, i, s, a) {
            switch (e.RequireFiniteNumber(t),
            e.RequireFiniteNumber(i),
            e.RequireFiniteNumber(s),
            e.RequireString(a),
            a) {
            case v[0]:
                this.#t._SetPosition(t, i, s, 4);
                break;
            case v[1]:
                this.#t._SetRotation(t, i, s, 4);
                break;
            case v[2]:
                this.#t._SetScale(t, i, s, 4);
                break;
            default:
                console.warn(`invalid transform type "${a}", valid transform types are: "${v}"`)
            }
        }
        set offsetX(t) {
            this.#t._SetOffsetX(t)
        }
        get offsetX() {
            return this.#t._GetOffsetX()
        }
        set offsetY(t) {
            this.#t._SetOffsetY(t)
        }
        get offsetY() {
            return this.#t._GetOffsetY()
        }
        set offsetZ(t) {
            this.#t._SetOffsetZ(t)
        }
        get offsetZ() {
            return this.#t._GetOffsetZ()
        }
        set rotationX(t) {
            this.#t._SetRotationX(t)
        }
        get rotationX() {
            return this.#t._GetRotationX()
        }
        set rotationY(t) {
            this.#t._SetRotationY(t)
        }
        get rotationY() {
            return this.#t._GetRotationY()
        }
        set rotationZ(t) {
            this.#t._SetRotationZ(t)
        }
        get rotationZ() {
            return this.#t._GetRotationZ()
        }
        set scaleX(t) {
            this.#t._SetScaleX(t)
        }
        get scaleX() {
            return this.#t._GetScaleX()
        }
        set scaleY(t) {
            this.#t._SetScaleY(t)
        }
        get scaleY() {
            return this.#t._GetScaleY()
        }
        set scaleZ(t) {
            this.#t._SetScaleZ(t)
        }
        get scaleZ() {
            return this.#t._GetScaleZ()
        }
        set isPlaying(t) {
            const e = this.#t
              , i = e._GetAnimation()
              , s = e._GetProgress();
            e._SetAnimation(i, t, s, !0)
        }
        get isPlaying() {
            return this.#t._IsPlaying()
        }
        getAllMeshes() {
            return this.#t._GetAllMeshes()
        }
        getAllAnimations() {
            return this.#t._GetAllAnimations()
        }
        animationDuration(t) {
            return e.RequireString(t),
            this.#t._GetAnimationDuration(t)
        }
        play(t="", i=0) {
            e.RequireString(t),
            e.RequireFiniteNumber(i),
            this.#t._Play(t, i)
        }
        stop() {
            this.#t._Stop()
        }
        pause() {
            this.#t._Pause()
        }
        resume() {
            this.#t._Resume()
        }
    }
}
{
    const t = self.C3;
    t.Plugins.Model3D.Cnds = {
        OnLoadModel: () => !0,
        OnLoadModelFail: () => !0,
        ForEach(t, e) {
            if (!this.GetAnimatedModel())
                return !1;
            const i = this.GetRuntime()
              , s = i.GetEventSheetManager()
              , a = i.GetCurrentEvent()
              , n = a.GetSolModifiers()
              , o = i.GetEventStack()
              , r = o.GetCurrentStackFrame()
              , h = o.Push(a)
              , _ = s.GetLoopStack()
              , l = _.Push()
              , d = ++t.depth
              , m = t.indexes;
            d === t.indexes.length ? m.push(0) : m[d] = 0,
            i.SetDebuggingEnabled(!1);
            for (let t = 0; t < e; ++t) {
                m[d] = t,
                s.PushCopySol(n),
                l.SetIndex(t);
                this.GetObjectClass().GetCurrentSol().PickOne(this.GetInstance()),
                a.Retrigger(r, h),
                s.PopSol(n)
            }
            return i.SetDebuggingEnabled(!0),
            t.depth--,
            o.Pop(),
            _.Pop(),
            !1
        },
        ForEachMesh() {
            return t.Plugins.Model3D.Cnds.ForEach.call(this, this._meshLoop, this._GetAllMeshes().length)
        },
        ForEachAnimation() {
            return t.Plugins.Model3D.Cnds.ForEach.call(this, this._animationLoop, this._GetAllAnimations().length)
        },
        IsCollisionEnabled() {
            return this.GetWorldInfo().IsCollisionEnabled()
        },
        IsPlaying() {
            return this._IsPlaying()
        },
        MeshRenderMode(t) {
            let e = "";
            return 0 === t && (e = "hierarchy"),
            1 === t && (e = "isolate"),
            this._GetMeshRenderMode() === e
        }
    }
}
{
    const t = self.C3;
    t.Plugins.Model3D.Acts = {
        SetModel(t, e, i, s, a) {
            return this._LoadFile(t, e, i, s, a)
        },
        SetModelByName(t, e, i, s, a) {
            return this._LoadFile(t, e, i, s, a)
        },
        SetMesh(t) {
            this._SetMesh(t)
        },
        SetMeshRenderMode(t) {
            this._SetMeshRenderMode(t)
        },
        SetAnimation(t, e, i) {
            this._SetAnimation(t, e, i, !0)
        },
        SetProgress(t) {
            this._SetProgress(t)
        },
        SetTransform(e, i, s, a, n) {
            switch (n) {
            case 0:
                this._SetPosition(e, i, s, a);
                break;
            case 1:
                this._SetRotation(t.toRadians(e), t.toRadians(i), t.toRadians(s), a);
                break;
            case 2:
                this._SetScale(e, i, s, a)
            }
        },
        Play(t, e) {
            this._Play(t, e)
        },
        Stop() {
            this._Stop()
        },
        Pause() {
            this._Pause()
        },
        Resume() {
            this._Resume()
        },
        SetCollisions(t) {
            this.GetWorldInfo().SetCollisionEnabled(t)
        }
    }
}
{
    const t = self.C3
      , e = new Map;
    t.Plugins.Model3D.Exps = {
        SetLastErrorModel3dName(t, i) {
            e.set(i, t)
        },
        Error3dModelName() {
            return e.get(this)
        },
        Name() {
            return this._GetName()
        },
        Mesh() {
            return this._GetMesh()
        },
        MeshCount() {
            return this._GetMeshCount()
        },
        MeshAt(t) {
            return this._GetMeshAt(t)
        },
        Animation() {
            return this._GetAnimation()
        },
        AnimationCount() {
            return this._GetAnimationsCount()
        },
        AnimationAt(t) {
            return this._GetAnimationAt(t)
        },
        AnimationDuration(t) {
            return this._GetAnimationDuration(t)
        },
        Progress() {
            return this._GetProgress()
        },
        CurMesh() {
            return this._GetMeshAt(this._GetForIndex("mesh"))
        },
        CurAnimation() {
            return this._GetAnimationAt(this._GetForIndex("animation"))
        },
        OffsetX() {
            return this._GetOffsetX()
        },
        OffsetY() {
            return this._GetOffsetY()
        },
        OffsetZ() {
            return this._GetOffsetZ()
        },
        RotationX() {
            return t.toDegrees(this._GetRotationX())
        },
        RotationY() {
            return t.toDegrees(this._GetRotationY())
        },
        RotationZ() {
            return t.toDegrees(this._GetRotationZ())
        },
        ScaleX() {
            return this._GetScaleX()
        },
        ScaleY() {
            return this._GetScaleY()
        },
        ScaleZ() {
            return this._GetScaleZ()
        }
    }
}
