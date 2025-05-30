--[[
	WARNING: Heads up! This script has not been verified by ScriptBlox. Use at your own risk!
]]
    getgenv().Camlock_Settings = {
        Prediction = 0.144,
        AimPart = "HumanoidRootPart",
        Key = "Z",
        AutoPrediction = true,
        Notification = true,
        Button = true,
        AntiGroundShots = false,
        UnderGroundResolver = false,

        -- DO NOT TOUCH THIS OR THE CAMLOCK WILL NOT WORK --
        Version = "2.5.1",
        Credits = "space_0999",
        DiscordServer = "discord.gg/SKhamGzTdn"
    }
    
    
    loadstring(game:HttpGet('https://raw.githubusercontent.com/elxocasXD/Trip-Hub/main/Scripts/Cam%20Lock.lua'))()
